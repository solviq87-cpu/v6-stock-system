// 极简 QQ 邮箱 SMTP 客户端（smtp.qq.com 465 隐式TLS）
// 用法: await sendQQMail({ user, authCode, to, subject, text })
const tls = require('tls');

function sendQQMail({ user, authCode, to, subject, text }) {
  return new Promise((resolve, reject) => {
    const b64 = s => Buffer.from(s, 'utf8').toString('base64');
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
          if (m[2] === ' ') { // 多行结束
            clearTimeout(timer);
            if (!expect.includes(m[1])) return fail(new Error(`SMTP ${m[1]}: ${line}`));
            busy = false;
            if (onDone) onDone(); else { process.nextTick(run); }
            return;
          }
        }
        // 未完整则继续等 data 事件
        sock.once('data', () => {});
        setTimeout(function retry() { if (busy) check(); }, 50);
      };
      check();
    };

    sock.on('data', d => {
      buf += d.toString('utf8');
      if (!busy && queue.length) run();
      else if (busy) { /* check 轮询处理 */ }
    });
    sock.on('error', fail);
    sock.on('timeout', () => fail(new Error('SMTP 连接超时')));

    const done = () => { send('QUIT'); sock.end(); resolve(true); };
    // 预置命令队列
    queue.push(
      { cmd: 'EHLO quant-platform', expect: ['250'] },
      { cmd: 'AUTH LOGIN', expect: ['334'] },
      { cmd: b64(user), expect: ['334'] },
      { cmd: b64(authCode), expect: ['235'] },
      { cmd: `MAIL FROM:<${user}>`, expect: ['250'] },
      { cmd: `RCPT TO:<${to}>`, expect: ['250'] },
      { cmd: 'DATA', expect: ['354'] },
      {
        cmd: [
          `From: "量化看盘平台" <${user}>`,
          `To: <${to}>`,
          `Subject: =?UTF-8?B?${b64(subject)}?=`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
          '',
          b64(text),
          '.'
        ].join('\r\n'),
        expect: ['250'], onDone: done
      },
      { cmd: 'NOOP', expect: ['250'] }
    );
    // 等待 220 问候后启动
    const boot = setInterval(() => {
      if (buf.includes('220 ')) { clearInterval(boot); run(); }
    }, 50);
    setTimeout(() => { clearInterval(boot); if (!busy && !lastCode) fail(new Error('SMTP 问候超时')); }, 20000);
  });
}

module.exports = { sendQQMail };
