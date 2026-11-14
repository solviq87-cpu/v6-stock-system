'use strict';
// Read-only PR coverage verifier. Full V6 CI is a separate required gate.
const CONTEXT='v6/per-commit-smoke', MAX_COMMITS=32;
const REPO='solviq87-cpu/v6-stock-system';
const HASH=/^[a-f0-9]{40}$/;
function ensure(condition,message){if(!condition)throw new Error(message);}
function parseRunUrl(value){
 const match=/^https:\/\/github\.com\/solviq87-cpu\/v6-stock-system\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/.exec(value||'');
 if(!match)return null;
 const run_id=Number(match[1]),attempt_number=Number(match[2]);
 return Number.isSafeInteger(run_id)&&Number.isSafeInteger(attempt_number)?{run_id,attempt_number}:null;
}
function statusCandidate(data){
 ensure(Array.isArray(data),'invalid-status-list');
 // GitHub returns most recent statuses first. Always use the most recent
 // matching context; never fall back from a later failure to an earlier success.
 return data.find(item=>item.context===CONTEXT)||null;
}
async function audit({github,owner,repo,pr}){
 ensure(github&&github.rest,'github-read-client-missing');
 ensure(owner==='solviq87-cpu'&&repo==='v6-stock-system','repository-mismatch');
 ensure(pr&&Number.isSafeInteger(pr.number)&&HASH.test(pr.head?.sha||''),'invalid-pr-identity');
 const live=(await github.rest.pulls.get({owner,repo,pull_number:pr.number})).data;
 ensure(live.head?.sha===pr.head.sha&&live.base?.sha===pr.base?.sha,'pr-head-or-base-changed');
 ensure(live.head?.repo?.full_name===REPO,'fork-branch-no-source-receipts');
 const n=live.commits;
 ensure(Number.isSafeInteger(n)&&n>0&&n<=MAX_COMMITS,'pr-exceeds-verified-commit-cap');
 const response=await github.rest.pulls.listCommits({owner,repo,pull_number:pr.number,per_page:100});
 const commits=response.data;
 ensure(Array.isArray(commits)&&commits.length===n&&commits.at(-1)?.sha===live.head.sha,'incomplete-pr-commit-page');
 ensure(new Set(commits.map(c=>c.sha)).size===n&&commits.every(c=>HASH.test(c.sha)),'invalid-pr-commit-shas');
 const bad=[],good=[];
 const cache=new Map();
 for(const commit of commits){
   const sha=commit.sha;
   try{
     const raw=await github.rest.repos.listCommitStatusesForRef({owner,repo,ref:sha,per_page:100,page:1});
     ensure(raw.data.length<100,'status-pagination-not-covered:'+sha.slice(0,12));
     const record=statusCandidate(raw.data);
     ensure(record&&record.state==='success','missing-or-failed-smoke-status');
     ensure(record.creator?.login==='github-actions[bot]','unexpected-status-source');
     const runRef=parseRunUrl(record.target_url);
     ensure(runRef,'untrusted-status-run-link');
     const key=runRef.run_id+'/'+runRef.attempt_number;
     let saved=cache.get(key);
     if(!saved){
       const run=(await github.rest.actions.getWorkflowRun({owner,repo,run_id:runRef.run_id})).data;
       ensure(run.name==='V6 Per-Commit Smoke'&&run.conclusion==='success'&&run.status==='completed'&&
              run.head_repository?.full_name===REPO,'unverified-smoke-run');
       const result=(await github.rest.actions.listJobsForWorkflowRunAttempt({
         owner,repo,run_id:runRef.run_id,attempt_number:runRef.attempt_number,per_page:100,page:1
       })).data;
       ensure(result.total_count===result.jobs?.length&&result.total_count<=100,'incomplete-smoke-jobs');
       saved=result.jobs;
       cache.set(key,saved);
     }
     const matching=saved.filter(j=>j.name==='per-sha-'+sha);
     const evidence=saved.filter(j=>j.name==='per-commit-evidence');
     ensure(matching.length===1&&matching[0].status==='completed'&&matching[0].conclusion==='success'&&
            evidence.length===1&&evidence[0].conclusion==='success','specific-sha-job-unverified');
     good.push(sha);
   }catch(err){bad.push({sha:sha.slice(0,12),reason:String(err.message||err).slice(0,160)});}
 }
 return {ok:bad.length===0,head:pr.head.sha,checked:n,passed:good.length,failures:bad};
}
module.exports={audit,statusCandidate,parseRunUrl,CONTEXT,MAX_COMMITS};
