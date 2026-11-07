// _mail_heartbeat.js —— 邮件通道独立心跳（iq 轮，2026-10-19）
//
// 背景：邮件作为飞书之外的备用推送通道，配置后长期不触发就不知道什么时候已经失效。
// 本脚本独立运行，只检查 SMTP 登录 + RCPT 是否成功，默认不实际发送邮件（避免打扰用户）。
// 如需真实发一封心跳邮件，加 --send 参数。
//
// 产出：mail_heartbeat.json，供面板 /api/lock/status 读取并展示。

const fs = require('fs');
const path = require('path');
const tls = require('tls');

const ROOT = __dirname;
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OUT = path.join(ROOT, 'mail_heartbeat.json');

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

function smtpHeartbeat({ user, authCode, to, actuallySend = false }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: 'smtp.qq.com', port: 465, timeout: 20000 }, () => {});
    let buf = '';
    let busy = false;
    const queue = [];
    let lastCode = '';
    const fail = e => { try { sock.destroy(); } catch {}; reject(e); };
    const send = line => sock.write(line + '\r\n');
    const run = () => {
      if (busy || !queue.length) return;
      busy = true;
      const { cmd, expect, onDone } = queue.shift();
      send(cmd);
      const timer = setTimeout(() => fail(new Error('SMTP 超时')), 20000);
      const check = () => {
        let idx;
        while ((idx = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const m = line.match(/^(\d{3})([ -])/);
          if (!m) continue;
          lastCode = m[1];
          if (m[2] === ' ') {
            clearTimeout(timer);
            if (!expect.includes(m[1])) return fail(new Error(`SMTP ${m[1]}: ${line}`));
            busy = false;
            if (onDone) onDone(); else process.nextTick(run);
            return;
          }
        }
        sock.once('data', () => {});
        setTimeout(function retry() { if (busy) check(); }, 50);
      };
      check();
    };
    sock.on('data', d => { buf += d.toString('utf8'); if (!busy && queue.length) run(); });
    sock.on('error', fail);
    sock.on('timeout', () => fail(new Error('SMTP 连接超时')));

    const finish = () => { send('QUIT'); sock.end(); resolve(true); };
    const noop = () => { send('RSET'); finish(); };

    queue.push(
      { cmd: 'EHLO quant-platform', expect: ['250'] },
      { cmd: 'AUTH LOGIN', expect: ['334'] },
      { cmd: b64(user), expect: ['334'] },
      { cmd: b64(authCode), expect: ['235'] },
      { cmd: `MAIL FROM:<${user}>`, expect: ['250'] },
      { cmd: `RCPT TO:<${to}>`, expect: ['250'] }
    );

    if (actuallySend) {
      const subject = '=?UTF-8?B?' + b64('量化看盘·邮件通道心跳') + '?=';
      const text = b64(`邮件通道心跳检测于 ${new Date().toLocaleString('zh-CN')}。\n若收到本邮件，说明 SMTP 通道正常。`);
      queue.push(
        { cmd: 'DATA', expect: ['354'] },
        {
          cmd: [
            `From: "量化看盘平台" <${user}>`,
            `To: <${to}>`,
            `Subject: ${subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            text,
            '.'
          ].join('\r\n'),
          expect: ['250'], onDone: finish
        }
      );
    } else {
      queue.push({ cmd: 'NOOP', expect: ['250'], onDone: noop });
    }

    const boot = setInterval(() => {
      if (buf.includes('220 ')) { clearInterval(boot); run(); }
    }, 50);
  });
}

function main() {
  const argv = process.argv.slice(2);
  const actuallySend = argv.includes('--send');
  const m = CFG.qqMail || {};
  const result = { ts: Date.now(), ok: false, mode: actuallySend ? 'send' : 'noop', info: '' };

  if (!m.user || !m.authCode || !m.to) {
    result.info = '邮件未配置（user/authCode/to 缺一个或多个）';
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(result.info);
    process.exit(0);
  }

  smtpHeartbeat({ user: m.user, authCode: m.authCode, to: m.to, actuallySend })
    .then(() => {
      result.ok = true;
      result.info = actuallySend ? '心跳邮件已发送' : 'SMTP 登录+RCPT 验证通过（未实际发信）';
      fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
      console.log('✓', result.info);
    })
    .catch(e => {
      result.ok = false;
      result.info = String(e && e.message || e);
      fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
      console.error('✗ 邮件心跳失败：', result.info);
      process.exit(1);
    });
}

if (require.main === module) main();
module.exports = { smtpHeartbeat };
