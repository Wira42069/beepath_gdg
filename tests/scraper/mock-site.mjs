// A small stand-in for the Binus certification site, used by the scraper tests.
// It copies the parts the scraper depends on, observed on the real site in Nov 2026:
//   - BinusMaya opens /?Token=...&Page=Dashboard in a popup; the token becomes a session cookie
//   - every /Student/* page needs that cookie, otherwise 302 -> /UnAuthorize
//   - the dashboard fills its list with an async postback after load, and pages with
//     __doPostBack('ctl00$MainContent$PageButtonNext','') etc. (no page URLs)
//   - detail pages at /Student/CertificateInfo?ID=<guid> fill themselves with one postback
//   - element ids such as MainContent_rptData_CertName_0
// All certificate data here is made up.
import http from 'node:http';
import crypto from 'node:crypto';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function makeItems(n) {
  return Array.from({ length: n }, (_, i) => {
    const k = String(i + 1).padStart(4, '0');
    const long = `Mock certificate number ${i + 1} teaches made-up skills for testing the scraper. `.repeat(4).trim();
    return {
      id: `00000000-0000-4000-8000-00000000${k}`,
      code: `CERT9${k}`,
      title: `Mock Certificate ${i + 1}${i === 1 ? ' &  Ampersand <Test>' : ''}`,
      credit: i === 2 ? 'Credit Earning Available' : 'Non Credit Earning Only',
      description: long,
      outcomes: i % 4 === 0 ? 'Not Defined' : i === 1 ? 'Line one<br/>• bullet two<br/>• bullet three' : `Outcome for ${i + 1}`,
      administrator: `Mock Provider ${(i % 3) + 1}`,
      institution: i % 5 === 0 ? 'Not Defined' : `Mock Institution ${(i % 2) + 1}`,
      duration: ['10 Hours', '2 Hari', '90-110 hours', '1 Bulan'][i % 4],
      courses: i === 2 ? 'COMP0001 - Mock Course One<br/>COMP0002 - Mock Course Two' : null,
    };
  });
}

const shortText = (s) => (s.length > 120 ? `${s.slice(0, 120)} ...` : s);

export function createMockSite({ items = makeItems(23), pageSize = 10, windowSize = 10, expireAfter = Infinity, expiryStyle = 'redirect', latencyMs = 5 } = {}) {
  const sessions = new Map(); // sid -> request count
  const stats = { logins: 0, expired: 0, requests: 0, detailPosts: 0, listPosts: 0 };
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const windowStart = (cur) => Math.max(1, Math.min(cur - Math.floor(windowSize / 2), totalPages - windowSize + 1));

  function sessionOf(req) {
    const m = /(?:^|;\s*)ASP\.NET_SessionId=([^;]+)/.exec(req.headers.cookie ?? '');
    if (!m || !sessions.has(m[1])) return null;
    const used = sessions.get(m[1]) + 1;
    if (used > expireAfter) {
      sessions.delete(m[1]);
      stats.expired += 1;
      return null;
    }
    sessions.set(m[1], used);
    return m[1];
  }

  const shell = (title, body, script) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>
<header class="profile"><span id="lblStudentName">TEST STUDENT 2501234567</span></header>
<main><form id="form1" method="post"><input type="hidden" id="__STATE" value="0">
<div id="MainContent_ctl00">${body}</div></form></main>
<script>
function __doPostBack(target, arg) {
  var fd = new URLSearchParams();
  fd.set('__EVENTTARGET', target);
  fd.set('__STATE', document.getElementById('__STATE').value);
  fetch(location.pathname + location.search, { method: 'POST', body: fd, credentials: 'same-origin' })
    .then(function (r) { return r.text(); })
    .then(function (t) {
      if (t.indexOf('REDIRECT|') === 0) { location.href = t.slice(9); return; }
      if (t.indexOf('|||') < 0) { console.error('parser error'); return; }
      var i = t.indexOf('|||');
      document.getElementById('__STATE').value = t.slice(0, i);
      document.getElementById('MainContent_ctl00').innerHTML = t.slice(i + 3);
    });
}
${script ?? ''}
</script></body></html>`;

  function listPanel(page) {
    const from = (page - 1) * pageSize;
    const rows = items.slice(from, from + pageSize).map((it, i) => `
      <div class="col-sm-12 item__certificate"><div class="row">
        <div class="certificate_thumbnail"><img id="MainContent_rptData_CertThumbnailImage_${i}" src="/thumb.png"></div>
        <div class="certificate_info"><div class="certificate_title">
          <a id="MainContent_rptData_CertName_${i}" href="/Student/CertificateInfo?ID=${it.id}">${esc(it.code)} - ${esc(it.title)}</a>
          <span id="MainContent_rptData_txtAvailableCreditEarning_${i}" class="credit__info">${esc(it.credit)}</span></div>
          <div class="certificate_description"><span>Description</span>
          <span id="MainContent_rptData_CertDescription_${i}" class="description">${esc(shortText(it.description))}</span>
          <span>Learning Outcomes</span>
          <span id="MainContent_rptData_CertOutcomes_${i}" class="description">${it.outcomes}</span></div></div>
        <div class="certificate_info_detail"><table>
          <tr><th>Administrator </th></tr><tr><td><span id="MainContent_rptData_CertAdministrator_${i}">${esc(it.administrator)}</span></td></tr>
          <tr><th>Institution </th></tr><tr><td><span id="MainContent_rptData_CertInstitution_${i}">${esc(it.institution)}</span></td></tr>
          <tr><th>Learning Duration </th></tr><tr><td><span id="MainContent_rptData_DurationOfLearning_${i}">${esc(it.duration)}</span></td></tr>
        </table></div></div></div>`).join('');
    const start = windowStart(page);
    const nums = [];
    for (let n = start, k = 0; n <= Math.min(totalPages, start + windowSize - 1); n++, k++) {
      nums.push(n === page ? `<span class="current">${n}</span>`
        : `<a href="javascript:__doPostBack('ctl00$MainContent$rptPageButton$ctl${String(k).padStart(2, '0')}$PageButton','')">${n}</a>`);
    }
    const to = Math.min(items.length, from + pageSize);
    return `<div id="MainContent_pnlIndex"><h2>Certification</h2>
      <select id="MainContent_ddlSearchBy"><option value="">Select Search By</option></select>
      <div class="row">${rows}</div>
      <div class="dataTables_info" role="status">Showing <span>${items.length ? from + 1 : 0}</span> to <span>${to}</span> of <span>${items.length}</span> entries</div>
      <div class="paging">
        ${page > 1 ? `<a href="javascript:__doPostBack('ctl00$MainContent$PageButtonPrevious','')">Previous</a>` : ''}
        ${nums.join(' ')}
        ${page < totalPages ? `<a href="javascript:__doPostBack('ctl00$MainContent$PageButtonNext','')">Next</a>` : ''}
      </div></div>`;
  }

  function detailPanel(it) {
    const options = [`<tr><td><span id="MainContent_rptMappingData_lblCertificateInfo_0">Submit your certification as a Non Credit Earning <br />(Your certificate will be attached as <i>Dokumen Pendamping Ijazah(DPI)</i>)</span>
        <span id="MainContent_rptMappingData_lblCertList_0"></span><span id="MainContent_rptMappingData_lblCourseInfo_0"></span><span id="MainContent_rptMappingData_lblCourseInfoList_0"></span></td>
        <td></td><td><input type="hidden" id="MainContent_rptMappingData_hdnMapId_0" value="noncredit"><input type="radio" name="credit_earning_option"></td></tr>`];
    if (it.courses) {
      options.push(`<tr><td><span id="MainContent_rptMappingData_lblCertificateInfo_1">Submit your certification as a Credit Earning</span>
        <span id="MainContent_rptMappingData_lblCertList_1">${esc(it.code)}</span><span id="MainContent_rptMappingData_lblCourseInfo_1">Courses:</span>
        <span id="MainContent_rptMappingData_lblCourseInfoList_1">${it.courses}</span></td>
        <td>4 SKS</td><td><input type="hidden" id="MainContent_rptMappingData_hdnMapId_1" value="map-${it.id.slice(-4)}"><input type="radio" name="credit_earning_option"></td></tr>`);
    }
    return `<div id="MainContent_pnlIndex"><div class="certificate_info">
      <a id="MainContent_CertName">${esc(it.code)} - ${esc(it.title)}</a>
      <span id="MainContent_CertDescription" class="description">${esc(it.description)}</span>
      <span id="MainContent_CertOutcomes" class="description">${it.outcomes}</span>
      <span id="MainContent_CertAdministrator" class="description">${esc(it.administrator)}</span>
      <span id="MainContent_CertInstitution" class="description">${esc(it.institution)}</span>
      <span id="MainContent_DurationOfLearning" class="description">${esc(it.duration)}</span></div>
      <table id="tblMappingData">${options.join('')}</table>
      <input type="submit" id="MainContent_btnNextUpload" value="Upload Certificate"></div>`;
  }

  const readBody = (req) => new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(new URLSearchParams(data)));
  });

  const send = (res, status, body, headers = {}) => {
    setTimeout(() => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      res.end(body);
    }, latencyMs);
  };
  const redirect = (res, location, headers = {}) => send(res, 302, '', { location, ...headers });
  const signedOutPostBack = (res) => (expiryStyle === 'silent'
    ? send(res, 200, '<html>UnAuthorize</html>') // MsAjax would choke on this and leave the page as is
    : send(res, 200, 'REDIRECT|/UnAuthorize'));

  const server = http.createServer(async (req, res) => {
    stats.requests += 1;
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname.toLowerCase();

    if (p === '/mock-binusmaya') {
      // Pretend the student signed in and clicked "Certification": BinusMaya opens a popup with a token.
      const mode = url.searchParams.get('mode');
      const script = mode === 'never' ? '' : "setTimeout(function () { window.open('/?Token=one-time-secret&Page=Dashboard', '_blank'); }, 100);";
      return send(res, 200, `<!doctype html><title>BinusMaya</title><p>Mock BinusMaya</p><script>${script}</script>`);
    }
    if (p === '/' && url.searchParams.get('Token')) {
      const sid = crypto.randomBytes(12).toString('hex');
      sessions.set(sid, 0);
      stats.logins += 1;
      return redirect(res, `/Student/${url.searchParams.get('Page') ?? 'Dashboard'}?Token=${url.searchParams.get('Token')}`, {
        'set-cookie': `ASP.NET_SessionId=${sid}; path=/; HttpOnly; SameSite=Lax`,
      });
    }
    if (p === '/unauthorize') return send(res, 200, '<!doctype html><title>Certification</title><p>UnAuthorize</p><a href="/mock-binusmaya">Go to Login Page</a>');
    if (p === '/thumb.png') return send(res, 200, '', { 'content-type': 'image/png' });

    if (p === '/student/dashboard') {
      if (req.method === 'GET') {
        if (!sessionOf(req)) return redirect(res, '/UnAuthorize');
        return send(res, 200, shell('Certification', '', "window.addEventListener('load', function () { setTimeout(function () { __doPostBack('init', ''); }, 30); });"));
      }
      const body = await readBody(req);
      if (!sessionOf(req)) return signedOutPostBack(res);
      stats.listPosts += 1;
      const cur = Number(body.get('__STATE')) || 1;
      const target = body.get('__EVENTTARGET') ?? '';
      let page = 1;
      if (/PageButtonNext$/.test(target)) page = cur + 1;
      else if (/PageButtonPrevious$/.test(target)) page = cur - 1;
      else {
        const m = /rptPageButton\$ctl(\d+)\$PageButton$/.exec(target);
        if (m) page = windowStart(cur) + Number(m[1]);
      }
      page = Math.max(1, Math.min(totalPages, page));
      return send(res, 200, `${page}|||${listPanel(page)}`);
    }

    if (p === '/student/certificateinfo') {
      const it = items.find((x) => x.id === (url.searchParams.get('ID') ?? '').toLowerCase());
      if (req.method === 'GET') {
        if (!sessionOf(req)) return redirect(res, '/UnAuthorize');
        if (!it) return send(res, 404, 'not found');
        return send(res, 200, shell('Certification', '', "window.addEventListener('load', function () { __doPostBack('ctl00$MainContent$btnInitData', ''); });"));
      }
      await readBody(req);
      if (!sessionOf(req)) return signedOutPostBack(res);
      stats.detailPosts += 1;
      return send(res, 200, `0|||${detailPanel(it)}`);
    }

    return send(res, 404, 'not found');
  });

  return {
    server,
    stats,
    items,
    sessions,
    async start() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      this.origin = `http://127.0.0.1:${server.address().port}`;
      this.loginUrl = `${this.origin}/mock-binusmaya`;
      return this;
    },
    expireAll() {
      stats.expired += sessions.size;
      sessions.clear();
    },
    /** Simulate this computer losing the network: stop listening (connection refused), then come back. */
    async goOffline(ms) {
      const { port } = server.address();
      stats.outages = (stats.outages ?? 0) + 1;
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      setTimeout(() => server.listen(port, '127.0.0.1'), ms);
    },
    close() {
      server.closeAllConnections?.();
      return new Promise((r) => { if (server.listening) server.close(r); else r(); });
    },
  };
}
