/* =============================================================================
 * _selftest.js — 算法自检（贴进 Tasker 的 JavaScriptlet 直接跑）
 * -----------------------------------------------------------------------------
 * 用途：不开网络、不用账号，只验证 byd.js 里的每个算法在 Tasker 的 JS 引擎上
 *       算出来的结果和电脑上（V8）完全一致。
 *
 * 用法：
 *   1  Tasker 建一个任务，用 JavaScript 动作，Libraries 指向 byd.js（合并版）
 *   2  把本文件全部内容粘进代码框，运行
 *   注意：自检时不要设 %cmd，否则 byd.js 里的 main() 会先跑一遍真实请求
 *   3  运行，看 %http_data
 *
 * 输出：41 行左右，每行 `NN OK  名称` 或 `NN NG  名称  got=…  exp=…`
 *       末行 `== 41/41 通过 ==`。有任何 NG 就是那一步在 Tasker 上跑不通。
 *
 * 注意：脚本会临时改写 encrypttoken 等 6 个任务变量做请求体测试，
 *       跑完在 finally 里原样恢复，不会破坏你真实保存的值。
 * ========================================================================== */

var http_data = '';

(function () {

    var R = [], okN = 0, badN = 0;

    function no(n) { return n < 10 ? '0' + n : '' + n; }

    function cut(s) {
        s = String(s);
        return s.length > 42 ? s.substr(0, 42) + '...' : s;
    }

    function T(name, got, exp) {
        var idx = okN + badN + 1;
        if (String(got) === String(exp)) {
            okN++;
            R.push(no(idx) + ' OK  ' + name);
        } else {
            badN++;
            R.push(no(idx) + ' NG  ' + name + '  got=' + cut(got) + '  exp=' + cut(exp));
        }
    }

    /* ---- 0 库有没有加载进来 ---- */
    if (typeof Byd === 'undefined' || !Byd || !Byd.md5HexUpper) {
        http_data = 'byd.js 没加载进来。\n'
            + '1) 检查 JavaScriptlet 的 Libraries 里那个网址能不能打开\n'
            + '2) 网址没问题就是引擎太老：byd.js 用了 let/const，需要 Rhino 1.7.13+ 或 V8';
        return;
    }

    var B = Byd;
    var V = Byd.version;

    /* ---- 1 引擎基础能力 ---- */
    T('JSON 可用', (typeof JSON !== 'undefined' && typeof JSON.stringify === 'function') ? 'yes' : 'no', 'yes');
    T('Date.now() 可用', (typeof Date.now === 'function' && typeof Date.now() === 'number') ? 'yes' : 'no', 'yes');
    T('32 位整数运算', (0x80000000 | 0), -2147483648);
    T('byd.js 版本 3.x', V.split('.')[0], '3');

    /* ---- 2 MD5（含 UTF-8 编码） ---- */
    T('md5("")', B.md5HexUpper(''), 'D41D8CD98F00B204E9800998ECF8427E');
    T('md5("abc")', B.md5HexUpper('abc'), '900150983CD24FB0D6963F7D28E17F72');
    T('md5("中")', B.md5HexUpper('中'), 'AED1DFBC31703955E64806B799B67645');
    T('md5(手机号)', B.md5HexUpper('13800138000'), '7945BD83237335E5376FF44D62E4F0AE');
    T('md5(中文长串)', B.md5HexUpper('比亚迪 DiLink 5.0'), '821A73968F0DAE2F342165533FF4C481');

    /* ---- 3 SHA-256 / 登录密钥 ---- */
    T('sha256("")', B.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    T('sha256("abc")', B.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    T('pwdLoginKey("123456")', B.pwdLoginKey('123456'), 'F59BD65F7EDAFB087A81D4DCA06C4910');

    /* ---- 4 签名串 / sha1Mixed ---- */
    var sigFields = {
        appChannel: '99', identifier: '166239974579163136', identifierType: 0,
        imeiMD5: '15B78CF48B74B2ACDB3AE01E68FA7575', reqTimestamp: '1793264351028',
        targetBrand: '1', vehicleBrand: '1', vin: 'LGXCE4CB1P0123456'
    };
    var sigKey = B.md5HexUpper('9Ho5MJVTRiYEP3Kjpgoa6IBcdZ5NqhDjfWYlWv7VoymQ4txa9YMomnuQXxSUH3I7');
    var sigStr = B.buildSignString(sigFields, sigKey);
    T('签名串排序拼接', sigStr,
        'appChannel=99&identifier=166239974579163136&identifierType=0'
        + '&imeiMD5=15B78CF48B74B2ACDB3AE01E68FA7575&reqTimestamp=1793264351028'
        + '&targetBrand=1&vehicleBrand=1&vin=LGXCE4CB1P0123456&password=0F8B22E72DF22784AF5CA48162D964A9');
    T('sha1Mixed(签名串)', B.sha1Mixed(sigStr), '42ebFF871A5a4Aa1E963F3dbE8edDFf47Cbe139e');

    /* ---- 5 AES-128-CBC ---- */
    var AESK = 'E10ADC3949BA59ABBE56E057F20F883E';          /* = MD5("123456") */
    var AES_HELLO = '990B50AD1A0DAD95F6D37676D6AE0BCB';
    T('AES 加密 "hello"', B.aesEncryptHex('hello', AESK), AES_HELLO);
    T('AES 解密 "hello"', B.aesDecryptHex(AES_HELLO, AESK), 'hello');
    T('AES 加密中文', B.aesEncryptHex('比亚迪车控', AESK), 'E27577842FB13F25D575074BA48B957A');

    /* ---- 6 白盒信封 ---- */
    T('信封输出长度', B.encryptEnvelope('{"a":1}').length, 64);
    T('信封密文指纹', B.md5HexUpper(B.encryptEnvelope('{"a":1}')), '53719D6EE6FB18550A5EF9ADD609F3E7');
    var LONG = '比亚迪DiLink车控协议自检-0123456789-比亚迪DiLink车控协议自检-0123456789';
    T('信封长文中转', B.decryptEnvelope(B.encryptEnvelope(LONG)), LONG);

    /* ---- 7 请求体整条链路（临时改 6 个变量，finally 恢复） ---- */
    var bakE = (typeof encrypttoken === 'undefined') ? '' : String(encrypttoken);
    var bakG = (typeof signtoken === 'undefined') ? '' : String(signtoken);
    var bakS = (typeof superid === 'undefined') ? '' : String(superid);
    var bakU = (typeof userid === 'undefined') ? '' : String(userid);
    var bakT = (typeof identifiertype === 'undefined') ? '' : String(identifiertype);
    var bakN = (typeof energytype === 'undefined') ? '' : String(energytype);

    try {
        encrypttoken = 'TESTENCTOKEN0000000000000000000000000000000000000000000000000000';
        signtoken = 'TESTSIGNTOKEN000000000000000000000000000000000000000000000000000';
        superid = '166239974579163136';
        userid = '49222451';
        identifiertype = '0';
        energytype = '2';

        var VIN = 'LGXCE4CB1P0123456';

        var loginOuter = JSON.parse(B.decryptEnvelope(JSON.parse(B.loginBody('13800138000', '123456')).request));
        T('登录包 identifier', loginOuter.identifier, '13800138000');
        T('登录包 loginType', loginOuter.loginType, 0);

        var bodyStr = B.body('状态', '13800138000', '', VIN, null);
        var outer = JSON.parse(B.decryptEnvelope(JSON.parse(bodyStr).request));
        T('业务包 identifier=superid', outer.identifier, '166239974579163136');
        T('业务包 identifierType=0', outer.identifierType, 0);
        T('业务包 objective=VIN', outer.objective, VIN);
        T('业务包有 sign', outer.sign.length >= 36 ? 'yes' : 'no', 'yes');
        T('业务包 checkcode 自洽', outer.checkcode === B.computeCheckcode(outer) ? 'yes' : 'no', 'yes');

        var inner = JSON.parse(B.aesDecryptHex(outer.encryData, B.md5HexUpper(encrypttoken)));
        T('内层 vin', inner.vin, VIN);
        T('内层 energyType=2', inner.energyType, '2');
        T('内层 tboxVersion=3', inner.tboxVersion, '3');
        T('内层 imeiMD5', inner.imeiMD5, '7945BD83237335E5376FF44D62E4F0AE');

        /* 响应解包：自造一个服务端响应，用同一套算法解回来 */
        var FAKE = '{"electricityPercentage":62}';
        var fakeBiz = '{"code":"0","message":"","respondData":"'
            + B.aesEncryptHex(FAKE, B.md5HexUpper(encrypttoken)) + '"}';
        var fakeRaw = '{"response":"' + B.encryptEnvelope(fakeBiz) + '"}';
        T('响应解包', B.open(fakeRaw), FAKE);

        /* 凭证失效判定 */
        T('expired 认出失效码', B.expired('{"response":"' + B.encryptEnvelope('{"code":"20"}') + '"}'), true);
        T('expired 放过正常码', B.expired('{"response":"' + B.encryptEnvelope('{"code":"0"}') + '"}'), false);

    } catch (e) {
        R.push('!! 请求体测试中断: ' + (e && e.message ? e.message : e));
    } finally {
        encrypttoken = bakE;
        signtoken = bakG;
        superid = bakS;
        userid = bakU;
        identifiertype = bakT;
        energytype = bakN;
    }

    /* ---- 8 小工具 ---- */
    T('get 路径取值', B.get('{"a":{"b":{"c":"x"}}}', 'a.b.c'), 'x');
    T('get 取不到返回空', B.get('{"a":1}', 'a.b.c'), '');
    T('cmdKey("上锁")', B.cmdKey('上锁'), 'LOCKDOOR');
    T('serial 取值', B.serial('{"requestSerial":"RS-1"}'), 'RS-1');
    T('done 成功即停', B.done('上锁', '{"controlState":1}'), true);
    T('done 未完成继续', B.done('上锁', '{"controlState":0}'), false);
    T('climate(24,1,2)', JSON.stringify(B.climate(24, 1, 2)),
        '{"mainSettingTemp":8,"copilotSettingTemp":8,"cycleMode":2,"remoteMode":4,"timeSpan":1}');

    /* ---- 汇总 ---- */
    var total = okN + badN;
    var tail = badN === 0
        ? '== ' + okN + '/' + total + ' 全部通过 =='
        : '== ' + okN + '/' + total + ' 通过，' + badN + ' 项失败（看上面 NG 行） ==';

    http_data = '== byd.js ' + V + ' 自检 ==\n' + R.join('\n') + '\n' + tail;

})();
