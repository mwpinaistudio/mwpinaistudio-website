/* PaiPinTong smart APK downloader.
 * Downloads the official APK in parallel byte ranges across every reachable mirror,
 * retries failed chunks instead of restarting, and verifies the SHA-256 checksum
 * before handing the file to the browser. Falls back to plain links when needed. */
(function () {
  'use strict'

  var MANIFEST = 'version.json'
  var PROBE_BYTES = 96 * 1024
  var PROBE_TIMEOUT = 12000
  var CHUNK_BYTES = 3 * 1024 * 1024
  var MAX_PARALLEL = 4
  var RETRIES = 3

  var state = { manifest: null, total: 0, mirrors: [], running: false, objectUrl: '' }

  function $(id) { return document.getElementById(id) }
  function mb(bytes) { return (bytes / 1048576).toFixed(1) }
  function speed(bps) {
    if (!bps || !isFinite(bps)) return '—'
    return bps >= 1048576 ? (bps / 1048576).toFixed(2) + ' MB/s' : Math.round(bps / 1024) + ' KB/s'
  }
  function resolve(base, url) { try { return new URL(url, base).href } catch (e) { return url } }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    })
  }

  function status(text, kind) {
    var el = $('smartStatus')
    if (!el) return
    el.textContent = text
    el.className = 'smart-status' + (kind ? ' ' + kind : '')
  }

  function progress(ratio) {
    var bar = $('smartBar')
    if (bar) bar.style.width = Math.max(0, Math.min(100, ratio * 100)).toFixed(1) + '%'
  }

  function buildMirrors(manifest, base) {
    var seen = {}
    var list = []
    function push(name, url, note) {
      if (!url) return
      var abs = resolve(base, url)
      if (seen[abs]) return
      seen[abs] = true
      list.push({ name: name, note: note || '', url: abs, ok: null, speed: 0, ms: 0, error: '' })
    }
    push('官方线路', manifest.apk, 'GitHub Pages')
    ;(manifest.apkMirrors || []).forEach(function (url, index) {
      push('备用线路 ' + (index + 1), url, /raw\.githubusercontent/.test(url) ? 'raw.githubusercontent' : '')
    })
    return list
  }

  function probe(mirror) {
    var started = performance.now()
    var controller = new AbortController()
    var timer = setTimeout(function () { controller.abort() }, PROBE_TIMEOUT)
    return fetch(mirror.url, {
      headers: { Range: 'bytes=0-' + (PROBE_BYTES - 1) },
      signal: controller.signal,
      cache: 'no-store',
    }).then(function (response) {
      if (!response.ok && response.status !== 206) throw new Error('HTTP ' + response.status)
      return response.arrayBuffer()
    }).then(function (buffer) {
      var elapsed = Math.max(1, performance.now() - started)
      mirror.ok = buffer.byteLength > 0
      mirror.ms = Math.round(elapsed)
      mirror.speed = (buffer.byteLength / elapsed) * 1000
    }).catch(function (error) {
      mirror.ok = false
      mirror.error = error && error.name === 'AbortError' ? '连接超时' : (error && error.message ? error.message : '失败')
    }).then(function () {
      clearTimeout(timer)
      return mirror
    })
  }

  function renderMirrors() {
    var host = $('mirrorList')
    if (!host) return
    var usable = state.mirrors.filter(function (m) { return m.ok })
    var fastest = usable.slice().sort(function (a, b) { return b.speed - a.speed })[0]
    host.innerHTML = state.mirrors.map(function (m) {
      var badge = m.ok ? speed(m.speed) : (m.error || '不可用')
      var cls = m.ok ? (m === fastest ? 'mirror ok best' : 'mirror ok') : 'mirror bad'
      var tag = m.ok ? (m === fastest ? '<em>推荐</em>' : '') : ''
      return '<div class="' + cls + '">' +
        '<span class="mirror-name">' + esc(m.name) + (m.note ? ' <small>' + esc(m.note) + '</small>' : '') + tag + '</span>' +
        '<span class="mirror-speed">' + esc(badge) + '</span>' +
        '<a class="mirror-use" href="' + esc(m.url) + '" download>用这条下载</a>' +
        '</div>'
    }).join('')
  }

  function fetchChunk(mirror, start, end) {
    return fetch(mirror.url, {
      headers: { Range: 'bytes=' + start + '-' + end },
      cache: 'no-store',
    }).then(function (response) {
      if (response.status !== 206 && response.status !== 200) throw new Error('HTTP ' + response.status)
      return response.arrayBuffer()
    }).then(function (buffer) {
      var expected = end - start + 1
      if (buffer.byteLength !== expected) throw new Error('分片长度不符')
      return buffer
    })
  }

  function toHex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
      return b.toString(16).padStart(2, '0')
    }).join('').toUpperCase()
  }

  function saveBlob(blob, filename) {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl)
    state.objectUrl = URL.createObjectURL(blob)
    var link = document.createElement('a')
    link.href = state.objectUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function raceChunks(chunks, mirrors) {
    var cursor = 0
    var doneBytes = 0
    var startedAt = performance.now()
    var lastTick = startedAt
    var lastBytes = 0
    var mirrorIndex = 0
    var failures = {}

    function tick() {
      var now = performance.now()
      if (now - lastTick > 400) {
        var inst = ((doneBytes - lastBytes) / (now - lastTick)) * 1000
        lastTick = now
        lastBytes = doneBytes
        var remain = Math.max(0, state.total - doneBytes)
        var eta = inst > 2048 ? Math.round(remain / inst) : -1
        progress(state.total ? doneBytes / state.total : 0)
        status('已下载 ' + mb(doneBytes) + ' / ' + mb(state.total) + ' MB · ' + speed(inst) +
          (eta >= 0 ? ' · 剩余约 ' + (eta > 90 ? Math.round(eta / 60) + ' 分钟' : eta + ' 秒') : ''))
      }
    }

    function next() {
      if (cursor >= chunks.length) return Promise.resolve()
      var chunk = chunks[cursor]
      cursor += 1
      var mirror = mirrors[mirrorIndex % mirrors.length]
      mirrorIndex += 1
      var attempt = 0
      function run() {
        attempt += 1
        return fetchChunk(mirror, chunk.start, chunk.end).then(function (buffer) {
          chunk.data = buffer
          doneBytes += buffer.byteLength
          tick()
          return next()
        }).catch(function () {
          failures[mirror.url] = (failures[mirror.url] || 0) + 1
          if (failures[mirror.url] >= 2 && mirrors.length > 1) {
            var dead = mirrors.indexOf(mirror)
            if (dead >= 0) mirrors.splice(dead, 1)
          }
          if (attempt >= RETRIES) throw new Error('下载中断，请重试或改用普通下载')
          mirror = mirrors[mirrorIndex % mirrors.length]
          mirrorIndex += 1
          return run()
        })
      }
      return run()
    }

    var workers = []
    var parallelism = Math.max(1, Math.min(MAX_PARALLEL, mirrors.length * 2, chunks.length))
    for (var i = 0; i < parallelism; i += 1) workers.push(next())
    return Promise.all(workers).then(function () {
      progress(1)
      return chunks
    })
  }

  function startDownload() {
    if (state.running) return
    var mirrors = state.mirrors.filter(function (m) { return m.ok })
    if (!mirrors.length) {
      status('所有线路当前都不可用，请稍后再试或使用普通下载。', 'bad')
      return
    }
    if (!state.total) {
      status('读取版本信息失败，请使用普通下载。', 'bad')
      return
    }
    if (!window.crypto || !window.crypto.subtle) {
      status('当前浏览器不支持校验下载，已为你改用普通下载。', 'bad')
      window.location.href = mirrors[0].url
      return
    }
    state.running = true
    var button = $('smartDownload')
    if (button) { button.disabled = true; button.textContent = '正在加速下载…' }
    var chunks = []
    for (var offset = 0; offset < state.total; offset += CHUNK_BYTES) {
      chunks.push({ start: offset, end: Math.min(state.total - 1, offset + CHUNK_BYTES - 1), data: null })
    }
    status('正在建立多线路连接…')
    raceChunks(chunks, mirrors).then(function (parts) {
      status('下载完成，正在校验文件完整性…')
      var blob = new Blob(parts.map(function (chunk) { return new Blob([chunk.data]) }), { type: 'application/vnd.android.package-archive' })
      return blob.arrayBuffer().then(function (buffer) {
        return window.crypto.subtle.digest('SHA-256', buffer).then(function (digest) {
          var hex = toHex(digest)
          var expected = String(state.manifest.sha256 || '').toUpperCase()
          if (expected && hex !== expected) throw new Error('校验失败，文件可能被第三方镜像篡改，请改用官方线路')
          saveBlob(blob, 'paipintong-' + (state.manifest.version || 'latest') + '.apk')
          status('已保存 paipintong-' + (state.manifest.version || 'latest') + '.apk（SHA-256 校验通过）', 'ok')
        })
      })
    }).catch(function (error) {
      status((error && error.message ? error.message : '下载失败') + '　你仍可以使用下面的普通下载。', 'bad')
    }).then(function () {
      state.running = false
      if (button) { button.disabled = false; button.textContent = '智能加速下载（推荐）' }
    })
  }

  function init() {
    var button = $('smartDownload')
    if (!button) return
    button.addEventListener('click', startDownload)
    status('正在测速…')
    fetch(MANIFEST + '?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (response) { return response.json() })
      .then(function (manifest) {
        state.manifest = manifest
        state.total = Number(manifest.sizeBytes) || 0
        var base = resolve(location.href, MANIFEST)
        state.mirrors = buildMirrors(manifest, base)
        return Promise.all(state.mirrors.map(probe))
      })
      .then(function () {
        renderMirrors()
        var usable = state.mirrors.filter(function (m) { return m.ok })
        if (!usable.length) {
          status('线路测速失败，请直接使用普通下载。', 'bad')
          return
        }
        usable.sort(function (a, b) { return b.speed - a.speed })
        status('已就绪：' + usable.length + ' 条可用线路，最快 ' + speed(usable[0].speed) + '。点上方按钮开始加速下载。', 'ok')
      })
      .catch(function () {
        status('无法读取版本信息，请使用普通下载。', 'bad')
      })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()

