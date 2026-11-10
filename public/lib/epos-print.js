/* Epson network receipt printer (TM-m30III "BarTix1", 10.10.1.19) via ePOS-Print.
 * Pages send ESC/POS bytes straight to the printer: no bridge, no driver.
 * First use in each browser: open https://<printer> once and click Advanced > Proceed.
 *
 *   EposPrint.host()            saved printer address (default 10.10.1.19)
 *   EposPrint.setHost(ip)       save a different address on this device
 *   EposPrint.print(bytes)      send a Uint8Array of ESC/POS
 *   EposPrint.status()          { problem: '' | 'out of paper' | ... }
 */
(function () {
  var LS = 'epos_printer_host';
  var DEFAULT = '10.10.1.19';
  var NS = 'http://www.epson-pos.com/schemas/2011/03/epos-print';

  function host() {
    try { return (localStorage.getItem(LS) || DEFAULT).trim(); } catch (e) { return DEFAULT; }
  }
  function setHost(h) {
    try { h ? localStorage.setItem(LS, h.trim()) : localStorage.removeItem(LS); } catch (e) {}
  }
  function problem(status) {
    var s = Number(status) || 0;
    if (s & 0x00000020) return 'cover is open';
    if (s & 0x00080000) return 'out of paper';
    if (s & 0x00000008) return 'printer is offline';
    if (s & 0x00020000) return 'paper is running low';
    return '';
  }
  async function post(inner, timeoutMs) {
    var h = host();
    var xml = '<?xml version="1.0" encoding="utf-8"?>' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
      '<epos-print xmlns="' + NS + '">' + inner + '</epos-print></s:Body></s:Envelope>';
    var r;
    try {
      r = await fetch('https://' + h + '/cgi-bin/epos/service.cgi?devid=local_printer&timeout=' + timeoutMs, {
        method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8' }, body: xml,
      });
    } catch (e) {
      throw new Error("Can't reach the printer at " + h + '. Open https://' + h + ' on this device once, click Advanced > Proceed, then try again.');
    }
    var text = await r.text();
    var code = (text.match(/code="([^"]*)"/) || [])[1] || '';
    var status = (text.match(/status="([^"]*)"/) || [])[1] || '';
    if (!r.ok || !/success="true"/.test(text)) {
      throw new Error('Printer problem: ' + (problem(status) || code || ('HTTP ' + r.status)) + '.');
    }
    return { status: Number(status) || 0, problem: problem(status) };
  }
  function print(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return post('<command>' + hex + '</command>', 20000);
  }
  function status() { return post('', 5000); }

  window.EposPrint = { host: host, setHost: setHost, print: print, status: status, DEFAULT: DEFAULT };
})();
