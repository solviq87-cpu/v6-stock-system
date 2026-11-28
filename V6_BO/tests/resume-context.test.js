'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {checkpoint,resume}=require('../../scripts/resume-context');
const start='<!-- CURRENT_CHECKPOINT_START -->',end='<!-- CURRENT_CHECKPOINT_END -->';
test('the checked-in handoff has a usable current checkpoint',()=>{
  const document=fs.readFileSync(path.resolve(__dirname,'../../HANDOFF.md'),'utf8');
  assert.ok(checkpoint(document).length>0);
});
test('resume reads only one bounded current checkpoint, excluding historical payloads',()=>{
  assert.equal(checkpoint(`intro\n${start}\ncurrent\n${end}\n${'old'.repeat(100000)}`),'current');
  for(const text of ['missing',`${start}${end}`,`${end}x${start}`,`${start}a${end}${start}`,`${start}a${end}${end}`,`${start}${'x'.repeat(4001)}${end}`])
    assert.throws(()=>checkpoint(text));
});
test('resume shows actual local SHA and dirty state without claiming remote verification',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-resume-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','--initial-branch=dev']);
  fs.writeFileSync(path.join(root,'HANDOFF.md'),`${start}\ncheckpoint\n${end}\nHISTORICAL_CONTENT_NOT_FOR_RESUME`);
  git(['add','HANDOFF.md']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture']);
  const sha=git(['rev-parse','HEAD']);git(['update-ref','refs/remotes/origin/dev',sha]);
  fs.writeFileSync(path.join(root,'change.txt'),'CONTENTS_MUST_NOT_BE_READ');
  const result=resume(root);
  assert.equal(result.split('\n')[0],'部署交接（接手前先读）=DEPLOYMENT.md');
  assert.ok(result.includes(sha));assert.match(result,/落后0，领先0/);assert.match(result,/change\.txt/);
  assert.match(result,/不能证明远端 CI/);assert.doesNotMatch(result,/HISTORICAL_CONTENT|CONTENTS_MUST_NOT/);
  assert.ok(result.length<6000);
});
function resumeFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-resume-root-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init','--initial-branch=dev']);fs.writeFileSync(path.join(root,'HANDOFF.md'),`${start}\nfixture checkpoint\n${end}\n`);
 git(['add','HANDOFF.md']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture']);
 return root;
}
test('resume rejects an unpacked project inside an unrelated Git worktree',t=>{
 const outer=resumeFixture(t),nested=path.join(outer,'unpacked-project');fs.mkdirSync(nested);
 fs.writeFileSync(path.join(nested,'HANDOFF.md'),`${start}\nnot the outer project\n${end}`);
 assert.throws(()=>resume(nested),/Git.*根目录/);
});
test('resume bounds displayed dirty files without failing for a large ordinary worktree',t=>{
 const root=resumeFixture(t);
 for(let i=0;i<600;i++)fs.writeFileSync(path.join(root,`${String(i).padStart(4,'0')}-${'x'.repeat(120)}.js`),'');
 const result=resume(root);assert.match(result,/工作区（600项，最多显示12项）/);
 assert.match(result,/0000-/);assert.match(result,/0011-/);assert.doesNotMatch(result,/0012-/);
 assert.ok(result.length<6000);
});
