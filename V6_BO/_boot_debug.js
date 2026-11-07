// 临时：以“验证码回显”调试态启动服务，仅供自检脚本使用，跑完即删
process.env.QD_DEBUG_OTP = '1';
require('./server.js');
