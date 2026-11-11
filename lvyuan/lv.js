/* =====================================================================
 * tasker_login.js —— 唯一需要的一个文件（纯 ES5，兼容老 Rhino）
 *
 * 放 Tasker JavaScriptlet 的「库链接区」。库区要文件路径，不是粘代码。
 * 例如放 /sdcard/Tasker/tasker_login.js，库区就填这个路径。
 *
 * 库本身不往变量表里写任何东西，只提供下面 5 个函数，由你在代码区调用。
 *
 * ---------------------------------------------------------------------
 * 登录任务，7 个动作
 * ---------------------------------------------------------------------
 * 1  JavaScriptlet   粘下面【步骤 1】
 *                     → %sign %apikey %apisign
 * 2  HTTP Request    POST  intelligence-cloud/send/captcha
 *                     Body     {"sign":"%sign"}
 *                     Headers  api-key:%apikey
 *                              api-sign:%apisign
 * 3  Input Dialog    （填收到的验证码）→ %code
 * 4  JavaScriptlet   粘下面【步骤 2】（%sign 被覆盖成 RSA(验证码)，正常）
 *                     → %sign %apikey %apisign
 * 5  HTTP Request    POST  intelligence-cloud//login
 *                     Body     {"cellphone":"%user","deviceid":"%dev_id",
 *                               "deviceinfo":"XiaomiM2012K11AC#Android13#APP3.3.7",
 *                               "sign":"%sign","devicetype":"android"}
 *                     Headers  同动作 2
 * 6  JavaScriptlet   粘下面【步骤 3】→ %apptoken
 * 7  Variable Set    %LY_APPTOKEN = %apptoken      ← 唯一的"保存"
 *
 * ---------------------------------------------------------------------
 * 开机任务，2 个动作
 * ---------------------------------------------------------------------
 * 1  JavaScriptlet   粘下面【开机】→ %apikey %apisign
 * 2  HTTP Request    POST  intelligence-cloud/function/onPower
 *                     Body     {"code16":"%LY_CODE16","settingValue":"1"}
 *                     Headers  apptoken:%LY_APPTOKEN
 *                              api-key:%apikey
 *                              api-sign:%apisign
 *                              Content-Type:application/json
 *                              User-Agent:Xiaomi#Android13#APP3.3.7
 *
 * ---------------------------------------------------------------------
 * 代码区要粘的四段（就这四段，别的不需要）
 * ---------------------------------------------------------------------
 * 【步骤 1】发码
 *     var R = rsaPhone(user);
 *     var sign = R.sign;
 *     var apikey = R.apikey;
 *     var apisign = R.apisign;
 *
 * 【步骤 2】登录
 *     var R = rsaCode(code);
 *     var sign = R.sign;
 *     var apikey = R.apikey;
 *     var apisign = R.apisign;
 *
 * 【步骤 3】解 token
 *     var D = decodeToken(http_data);
 *     var apptoken = D.apptoken;
 *
 * 【开机】只要 api 头，不要手机号不要验证码
 *     var H = apiHeaders();
 *     var apikey = H.apikey;
 *     var apisign = H.apisign;
 *
 * ---------------------------------------------------------------------
 * 变量从哪来
 * ---------------------------------------------------------------------
 * %sign     步骤1 是 RSA(手机号)，步骤2 是 RSA(验证码)，88 字符 base64
 * %apikey   "time" + 13 位毫秒时间戳，17 字符
 * %apisign  SHA256("XU-O^IKF^B^JO" + %apikey + "0_Q45^298EO^W")，64 位 hex
 *           上面三个都是现算的，300 秒寿命，不用保存
 * %apptoken Base64(RSA("!791"+token+"nayuL"))，88 字符，步骤 3 产出
 * %LY_APPTOKEN / %LY_CODE16
 *           这两个是**你自己在变量页手工建的全局变量**，脚本不产出。
 *           建法：左侧菜单 → 变量 → + → 名称 LY_APPTOKEN，类型字符串。
 *           不建的话，动作 7 只会写进任务局部变量，开机时取不到值。
 * ===================================================================== */

var LY_N = "87aca78f00bcfb066f6be40c85d7eab65f52c5cc0b074a2696f6b4bbbbe0db6f"
         + "a5429f5916a8fe68726be693dbe96ad22ad2e861c6712c8ab339c40684dd0823";
var LY_E = 65537;
var LY_K = 64;

/* ---------------- 大整数（base 65536，小端分肢） ---------------- */
function lyNorm(a) {
  var i = a.length - 1;
  while (i > 0 && a[i] === 0) i--;
  a.length = i + 1;
  return a;
}
function lyFromHex(h) {
  var a = [], pos = h.length, st;
  while (pos > 0) {
    st = pos - 4;
    if (st < 0) st = 0;
    a.push(parseInt(h.substring(st, pos), 16));
    pos = st;
  }
  return lyNorm(a);
}
function lyCmp(a, b) {
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  for (var i = a.length - 1; i >= 0; i--) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}
function lySub(a, b) {
  var r = new Array(a.length), br = 0, v, i;
  for (i = 0; i < a.length; i++) {
    v = a[i] - (b[i] || 0) - br;
    if (v < 0) { v += 65536; br = 1; } else { br = 0; }
    r[i] = v;
  }
  return lyNorm(r);
}
function lyMul(a, b) {
  var r = [], t, carry, ai, k, i, j;
  for (i = 0; i < a.length + b.length; i++) r.push(0);
  for (i = 0; i < a.length; i++) {
    ai = a[i];
    if (ai === 0) continue;
    carry = 0;
    for (j = 0; j < b.length; j++) {
      t = r[i + j] + ai * b[j] + carry;
      r[i + j] = t & 0xffff;
      carry = Math.floor(t / 65536);
    }
    k = i + b.length;
    while (carry > 0 && k < r.length) {
      t = r[k] + carry;
      r[k] = t & 0xffff;
      carry = Math.floor(t / 65536);
      k++;
    }
  }
  return lyNorm(r);
}
function lyShl1Add(a, bit) {
  var r = [], carry = bit, v, i;
  for (i = 0; i < a.length; i++) {
    v = (a[i] << 1) + carry;
    r.push(v & 0xffff);
    carry = v >>> 16;
  }
  if (carry) r.push(carry);
  return r;
}
function lyBitLen(a) {
  var n = (a.length - 1) * 16, t = a[a.length - 1];
  while (t > 0) { n++; t >>>= 1; }
  return n;
}
function lyGetBit(a, i) {
  var li = i >> 4;
  if (li >= a.length) return 0;
  return (a[li] >> (i & 15)) & 1;
}
function lyMod(a, n) {
  var bl = lyBitLen(a), r = [0], i;
  for (i = bl - 1; i >= 0; i--) {
    r = lyShl1Add(r, lyGetBit(a, i));
    if (lyCmp(r, n) >= 0) r = lySub(r, n);
  }
  return lyNorm(r);
}
function lyModPow(base, eNum, n) {
  var top = 31, r, b, i;
  while (top > 0 && !((eNum >>> top) & 1)) top--;
  r = [1];
  b = lyMod(base, n);
  for (i = top; i >= 0; i--) {
    r = lyMod(lyMul(r, r), n);
    if ((eNum >>> i) & 1) r = lyMod(lyMul(r, b), n);
  }
  return r;
}
function lyToHex(a, bytes) {
  var out = "", h, i, want = bytes * 2;
  for (i = a.length - 1; i >= 0; i--) {
    h = a[i].toString(16);
    while (h.length < 4) h = "0" + h;
    out += h;
  }
  if (out === "") out = "0";
  while (out.length < want) out = "0" + out;
  return out;
}

/* ---------------- 字节与编码 ---------------- */
function lyH2(n) { return (n < 16 ? "0" : "") + n.toString(16); }
function lyAsciiToHex(s) {
  var out = "", i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c > 255) throw new Error("含非 ASCII 字符");
    out += lyH2(c);
  }
  return out;
}
function lyHexToAscii(h) {
  var s = "", i;
  for (i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.substr(i, 2), 16));
  return s;
}
var LY_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function lyB64FromHex(hex) {
  var bs = [], out = "", p, b0, b1, b2;
  for (p = 0; p < hex.length; p += 2) bs.push(parseInt(hex.substr(p, 2), 16));
  for (p = 0; p < bs.length; p += 3) {
    b0 = bs[p];
    b1 = (p + 1 < bs.length) ? bs[p + 1] : -1;
    b2 = (p + 2 < bs.length) ? bs[p + 2] : -1;
    out += LY_B64.charAt(b0 >> 2);
    out += LY_B64.charAt(((b0 & 3) << 4) | ((b1 < 0 ? 0 : b1) >> 4));
    out += (b1 < 0) ? "=" : LY_B64.charAt(((b1 & 15) << 2) | ((b2 < 0 ? 0 : b2) >> 6));
    out += (b2 < 0) ? "=" : LY_B64.charAt(b2 & 63);
  }
  return out;
}
function lyB64ToHex(s) {
  if (!s) return "";
  var hex = "", i, c0, c1, c2, c3, b0, b1, b2;
  for (i = 0; i + 1 < s.length; i += 4) {
    c0 = LY_B64.indexOf(s.charAt(i));
    c1 = LY_B64.indexOf(s.charAt(i + 1));
    c2 = (s.charAt(i + 2) === "=") ? -1 : LY_B64.indexOf(s.charAt(i + 2));
    c3 = (s.charAt(i + 3) === "=") ? -1 : LY_B64.indexOf(s.charAt(i + 3));
    if (c0 < 0 || c1 < 0) break;
    b0 = (c0 << 2) | (c1 >> 4);
    hex += lyH2(b0);
    if (c2 >= 0) { b1 = ((c1 & 15) << 4) | (c2 >> 2); hex += lyH2(b1); }
    if (c3 >= 0) { b2 = ((c2 & 3) << 6) | c3; hex += lyH2(b2); }
  }
  return hex;
}

/* ---------------- SHA-256 ---------------- */
function lySha256(str) {
  var KT = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  var bs = [], i, c;
  for (i = 0; i < str.length; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) bs.push(c);
    else if (c < 0x800) bs.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bs.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bs.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  var bitLen = bs.length * 8;
  bs.push(0x80);
  while (bs.length % 64 !== 56) bs.push(0);
  var hi = Math.floor(bitLen / 4294967296), lo = bitLen % 4294967296;
  bs.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  bs.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

  var w = new Array(64), o, t, a, b, cc, d, e, f, g, h, S0, S1, ch, maj, t1, t2;
  for (o = 0; o < bs.length; o += 64) {
    for (t = 0; t < 16; t++) {
      w[t] = ((bs[o + 4 * t] << 24) | (bs[o + 4 * t + 1] << 16) |
              (bs[o + 4 * t + 2] << 8) | bs[o + 4 * t + 3]) | 0;
    }
    for (t = 16; t < 64; t++) {
      S0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) | 0;
      S1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) | 0;
      w[t] = (w[t - 16] + S0 + w[t - 7] + S1) | 0;
    }
    a = H[0]; b = H[1]; cc = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
    for (t = 0; t < 64; t++) {
      S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) | 0;
      ch = ((e & f) ^ (~e & g)) | 0;
      t1 = (h + S1 + ch + KT[t] + w[t]) | 0;
      S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) | 0;
      maj = ((a & b) ^ (a & cc) ^ (b & cc)) | 0;
      t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = cc; cc = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  var out = "", k, hx;
  for (k = 0; k < 8; k++) {
    hx = (H[k] >>> 0).toString(16);
    while (hx.length < 8) hx = "0" + hx;
    out += hx;
  }
  return out;
}

/* ---------------- RSA ---------------- */
function lyPubEncrypt(plain) {
  var mHex = lyAsciiToHex(plain);
  var mLen = mHex.length / 2;
  if (mLen > LY_K - 11) throw new Error("明文 " + mLen + " 字节，超出 53 字节上限");
  var padLen = LY_K - 3 - mLen, ps = "", i, pb;
  for (i = 0; i < padLen; i++) {
    pb = 1 + Math.floor(Math.random() * 255);
    if (!pb || pb === 0) pb = 1;
    ps += lyH2(pb);
  }
  var emHex = "0002" + ps + "00" + mHex;
  return lyB64FromHex(lyToHex(lyModPow(lyFromHex(emHex), LY_E, lyFromHex(LY_N)), LY_K));
}
function lyPubDecrypt(b64) {
  if (!b64 || String(b64).length < 8) return { ok: false, why: "apptoken 为空" };
  var emHex = lyToHex(lyModPow(lyFromHex(lyB64ToHex(b64)), LY_E, lyFromHex(LY_N)), LY_K);
  if (emHex.substring(0, 2) !== "00") return { ok: false, why: "EM 首字节不是 00（不是本公钥签发的密文）" };
  /* 按字节对齐找分隔符：indexOf("00") 会命中奇数字节边界，导致整体错位一字节 */
  var sep = -1, j;
  for (j = 4; j < emHex.length; j += 2) {
    if (emHex.substring(j, j + 2) === "00") { sep = j; break; }
  }
  if (sep < 0) return { ok: false, why: "找不到填充分隔符" };
  var body = emHex.substring(sep + 2);
  if (!body) return { ok: false, why: "填充之后为空" };
  return { ok: true, text: lyHexToAscii(body) };
}

/* 一对 api 头（300 秒内有效） */
function lyApiHeaders() {
  var k = "time" + new Date().getTime();
  return { apikey: k, apisign: lySha256("XU-O^IKF^B^JO" + k + "0_Q45^298EO^W") };
}


/* =====================================================================
 * 主函数 1：算 RSA(手机号)
 *   rsaPhone(user) 或 rsaPhone("13800000000")
 * ===================================================================== */
function rsaPhone(u) {
  var phone = (u === undefined || u === null) ? "" : String(u);
  phone = phone.replace(/\D/g, "");
  if (!/^1\d{10}$/.test(phone)) {
    return { ok: false, why: "手机号不是 11 位:" + (phone || "空"), sign: "", apikey: "", apisign: "" };
  }
  try {
    var hd = lyApiHeaders();
    return { ok: true, why: "", sign: lyPubEncrypt(phone), apikey: hd.apikey, apisign: hd.apisign };
  } catch (e) {
    return { ok: false, why: "RSA 失败:" + e, sign: "", apikey: "", apisign: "" };
  }
}

/* =====================================================================
 * 主函数 2：算 RSA(验证码)
 *   rsaCode(input) 或 rsaCode("695870")
 * ===================================================================== */
function rsaCode(c) {
  var code = (c === undefined || c === null) ? "" : String(c);
  code = code.replace(/\D/g, "");
  if (!/^\d{4,8}$/.test(code)) {
    return { ok: false, why: "验证码不是 4~8 位数字:" + (code || "空"), sign: "", apikey: "", apisign: "" };
  }
  try {
    var hd = lyApiHeaders();
    return { ok: true, why: "", sign: lyPubEncrypt(code), apikey: hd.apikey, apisign: hd.apisign };
  } catch (e) {
    return { ok: false, why: "RSA 失败:" + e, sign: "", apikey: "", apisign: "" };
  }
}

/* =====================================================================
 * 主函数 3：从 login 响应解 token 并生成 apptoken
 *   decodeToken(http_data)
 * ===================================================================== */
function decodeToken(raw) {
  var s = (raw === undefined || raw === null) ? "" : String(raw);
  var m = s.match(/"apptoken"\s*:\s*"([^"]+)"/);
  if (!m) {
    var er = s.match(/"info"\s*:\s*"([^"]+)"/) || s.match(/"error"\s*:\s*"([^"]+)"/);
    return { ok: false, why: er ? er[1] : (s ? s.substring(0, 100) : "空响应"), token: "", apptoken: "" };
  }
  var d = lyPubDecrypt(m[1]);
  if (!d.ok) return { ok: false, why: d.why, token: "", apptoken: "" };
  try {
    return { ok: true, why: "", token: d.text, apptoken: lyPubEncrypt("!791" + d.text + "nayuL") };
  } catch (e) {
    return { ok: false, why: "apptoken 生成异常:" + e, token: d.text, apptoken: "" };
  }
}

/* =====================================================================
 * 主函数 4：由已有 token 直接生成 apptoken（不用重新登录）
 *   makeApptoken(token)
 * 明文 = "!791" + token + "nayuL"，正好 53 字节，卡满 512-bit 上限。
 * ===================================================================== */
function makeApptoken(t) {
  var s = (t === undefined || t === null) ? "" : String(t).replace(/\s/g, "");
  if (!s) return { ok: false, why: "token 为空", apptoken: "" };
  try {
    return { ok: true, why: "", apptoken: lyPubEncrypt("!791" + s + "nayuL") };
  } catch (e) {
    return { ok: false, why: "RSA 失败:" + e, apptoken: "" };
  }
}

/* =====================================================================
 * 主函数 5：只要 api 头（控车用，不需要手机号/验证码）
 *   apiHeaders() -> { apikey, apisign }
 * 这一对寿命 300 秒，所以必须和请求同一时刻算，不能存。
 * ===================================================================== */
function apiHeaders() {
  return lyApiHeaders();
}

/* 兼容用：也可以写成 LY.rsaPhone(user) */
var LY = {
  rsaPhone: rsaPhone,
  rsaCode: rsaCode,
  decodeToken: decodeToken,
  makeApptoken: makeApptoken,
  apiHeaders: apiHeaders
};
