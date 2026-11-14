#!/usr/bin/env node
'use strict';
// Read only the small current checkpoint. Historical records remain on disk for targeted lookup.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const START = '<!-- CURRENT_CHECKPOINT_START -->';
const END = '<!-- CURRENT_CHECKPOINT_END -->';
const MAX_CHECKPOINT = 4000;
function checkpoint(text) {
  const start=text.indexOf(START), end=text.indexOf(END);
  if(start<0 || end<=start || text.indexOf(START,start+START.length)!==-1 || text.indexOf(END,end+END.length)!==-1)
    throw Error('HANDOFF.md 必须包含唯一的当前检查点；请修复标记，不回退读取整个历史。');
  const value=text.slice(start+START.length,end).trim();
  if(!value || value.length>MAX_CHECKPOINT)
    throw Error('当前检查点为空或超过4000字符；历史证据请保留为链接。');
  return value;
}
function resume(root) {
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:64*1024,stdio:['ignore','pipe','pipe']}).trim();
  const note=checkpoint(fs.readFileSync(path.join(root,'HANDOFF.md'),'utf8'));
  const head=git(['rev-parse','HEAD']);
  const branch=git(['branch','--show-current']) || '(detached)';
  let remote='本地无 origin/dev；远端状态待查询';
  try {
    const sha=git(['rev-parse','refs/remotes/origin/dev']);
    const [behind,ahead]=git(['rev-list','--left-right','--count','refs/remotes/origin/dev...HEAD']).split(/\s+/);
    remote=`origin/dev（本地缓存）=${sha}；落后${behind}，领先${ahead}`;
  } catch {}
  const status=git(['status','--porcelain=v1','--untracked-files=normal']);
  const lines=status?status.split('\n'):[];
  const files=lines.slice(0,12).map(x=>x.slice(0,180)).join('\n') || '干净';
  return [`当前分支=${branch.slice(0,200)}`,`HEAD=${head}`,remote,
    `工作区（${lines.length}项，最多显示12项）：\n${files}`,
    '上述 Git 状态为本地实读；本命令不联网，不能证明远端 CI、合并或生产发布。',
    '\n当前检查点（历史快照，先与上方实际 SHA 核对）：',note].join('\n');
}
if(require.main===module) {
  try {process.stdout.write(resume(path.resolve(__dirname,'..'))+'\n');}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
module.exports={checkpoint,resume};
