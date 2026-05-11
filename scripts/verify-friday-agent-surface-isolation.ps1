param(
	[switch]$RefreshArtifacts,
	[string]$Vault = "test",
	[string]$PluginId = "friday-obsidian-plugin",
	[string]$PluginDir = "C:\Own Docm\Coding\Friday - Ob\test\.obsidian\plugins\friday-obsidian-plugin"
)

$ErrorActionPreference = "Stop"

$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ShortSha = (& git -C $Repo rev-parse --short HEAD).Trim()
$OutDir = Join-Path $env:TEMP "friday-surface-isolation-$ShortSha"
$ArtifactFiles = @("main.js", "styles.css", "manifest.json")
$BannedTerms = @(
	"Waiting for user",
	"Waiting for you",
	"Waiting for approval",
	"Before snapshot mismatch",
	"file change(s) pending review",
	"Pending file changes",
	"Applied file creation",
	"Applied file update",
	"Applied file deletion",
	"checkpoint",
	"model_request",
	"model request",
	"requesting model decision",
	"native tools",
	"prompt runtime",
	"Model step",
	"Agent is reasoning",
	"Model decision received",
	"raw reasoning",
	"debug",
	"replay",
	"View replay",
	"Cancel",
	"Continue",
	"Apply",
	"Reject",
	"Tool approval required",
	"Allow once",
	"Allow session",
	"Allow always"
)

function Invoke-RepoCommand {
	param([string]$FilePath, [string[]]$Arguments)
	Push-Location $Repo
	try {
		$output = & $FilePath @Arguments 2>&1
		if ($LASTEXITCODE -ne 0) {
			throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE`n$output"
		}
		return (($output | Out-String).Trim())
	}
	finally {
		Pop-Location
	}
}

function Invoke-Obsidian {
	param([string[]]$Arguments)
	$allArgs = @("vault=$Vault") + $Arguments
	$output = & obsidian @allArgs 2>&1
	if ($LASTEXITCODE -ne 0) {
		throw "obsidian $($allArgs -join ' ') failed with exit code $LASTEXITCODE`n$output"
	}
	return (($output | Out-String).Trim())
}

function Invoke-ObsidianEval {
	param([string]$Code)
	$encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Code))
	$wrapped = "eval(new TextDecoder().decode(Uint8Array.from(atob(``$encoded``), c => c.charCodeAt(0))))"
	$result = Invoke-Obsidian @("eval", "code=$wrapped")
	$normalized = (($result -replace "^\s*=>\s*", "").Trim())
	if ($normalized -match "^Error:") {
		throw "Obsidian eval failed:`n$normalized"
	}
	return $normalized
}

function Get-ArtifactHashRows {
	$rows = @()
	foreach ($file in $ArtifactFiles) {
		$src = Join-Path $Repo $file
		$dst = Join-Path $PluginDir $file
		$srcExists = Test-Path -LiteralPath $src
		$dstExists = Test-Path -LiteralPath $dst
		$srcHash = if ($srcExists) { (Get-FileHash -Algorithm SHA256 -LiteralPath $src).Hash } else { "" }
		$dstHash = if ($dstExists) { (Get-FileHash -Algorithm SHA256 -LiteralPath $dst).Hash } else { "" }
		$rows += [pscustomobject]@{
			file = $file
			sourceExists = $srcExists
			pluginExists = $dstExists
			match = ($srcExists -and $dstExists -and $srcHash -eq $dstHash)
			hash = $srcHash
		}
	}
	return $rows
}

function Sync-ArtifactsIfRequested {
	$rows = Get-ArtifactHashRows
	if (($rows | Where-Object { -not $_.match }).Count -eq 0) {
		return $rows
	}
	if (-not $RefreshArtifacts) {
		$rows | Format-Table -AutoSize | Out-String | Write-Host
		throw "Plugin artifacts are out of sync. Re-run with -RefreshArtifacts to build and copy them."
	}
	Invoke-RepoCommand "npm" @("run", "build") | Write-Host
	New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
	foreach ($file in $ArtifactFiles) {
		Copy-Item -Force -LiteralPath (Join-Path $Repo $file) -Destination $PluginDir
	}
	$rows = Get-ArtifactHashRows
	if (($rows | Where-Object { -not $_.match }).Count -ne 0) {
		$rows | Format-Table -AutoSize | Out-String | Write-Host
		throw "Plugin artifacts still do not match after refresh."
	}
	return $rows
}

function Assert-NoDevErrors {
	$errors = Invoke-Obsidian @("dev:errors")
	if ($errors -and $errors -notmatch "No errors captured") {
		throw "Obsidian dev:errors reported errors:`n$errors"
	}
}

function Invoke-DomBannedScan {
	$termsJson = ($BannedTerms | ConvertTo-Json -Compress)
	$code = @"
(()=>{const root=document.querySelector(".friday-daily-board");
if(!root) return "missing .friday-daily-board";
const terms=$termsJson;
const matches=[...root.querySelectorAll("*")]
  .filter(el=>terms.some(term=>(el.textContent||"").includes(term)))
  .filter(el=>![...el.children].some(child=>terms.some(term=>(child.textContent||"").includes(term))))
  .map(el=>({tag:el.tagName,className:String(el.className||""),text:(el.textContent||"").replace(/\s+/g," ").trim()}));
return JSON.stringify(matches);
})()
"@
	$result = Invoke-ObsidianEval $code
	if ($result -ne "[]") {
		throw "DOM banned terms scan failed:`n$result"
	}
	return $result
}

function Capture-Screenshot {
	param([string]$FileName)
	$path = Join-Path $OutDir $FileName
	Invoke-Obsidian @("dev:screenshot", "path=$path") | Out-Null
	if (-not (Test-Path -LiteralPath $path)) {
		throw "Screenshot was not created: $path"
	}
	return $path
}

function Reset-FridayAuditState {
	$code = @'
(()=>{const plugin=app.plugins.plugins["friday-obsidian-plugin"];
const view=app.workspace.getLeavesOfType("friday-daily-board")[0]?.view;
if(!plugin||!view) return "missing";
view.approvalQueue?.clearWithDecision?.("deny");
plugin.workbenchStateStore?.clearEditPlans?.();
view.aiRuntimeTrajectoryStore?.reset?.();
view.aiRuntimeTrajectorySnapshot=null;
view.aiStreamingTrajectorySnapshot=null;
view.aiLocalIntakePreview="";
view.aiStreamingPreview="";
view.aiAgentTasks=[];
view.aiProcessSnapshotsByKey?.clear?.();
view.aiProcessExpandedKeys?.clear?.();
view.aiProcessCollapsedKeys?.clear?.();
view.aiConversation=[];
view.aiDraft="";
view.renderBoard();
return "reset";
})()
'@
	Invoke-ObsidianEval $code | Out-Null
}

function Assert-FridayReady {
	$result = Invoke-ObsidianEval '(()=>{const plugin=app.plugins.plugins["friday-obsidian-plugin"]; const view=app.workspace.getLeavesOfType("friday-daily-board")[0]?.view; return plugin&&view ? "ready" : "missing";})()'
	if ($result -ne "ready") {
		throw "FRIDAY daily board is not ready: $result"
	}
}

function Run-Scenario {
	param(
		[string]$Name,
		[string]$Code,
		[string]$ScreenshotName
	)
	Write-Host "Scenario: $Name"
	$result = Invoke-ObsidianEval $Code
	Write-Host "  eval: $result"
	$screenshot = Capture-Screenshot $ScreenshotName
	Write-Host "  screenshot: $screenshot"
	$scan = Invoke-DomBannedScan
	Write-Host "  DOM banned terms scan: $scan"
	Assert-NoDevErrors
	return $screenshot
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$hashRows = Sync-ArtifactsIfRequested
Write-Host "Artifact hash preflight:"
$hashRows | Format-Table -AutoSize | Out-String | Write-Host

Invoke-Obsidian @("dev:errors", "clear") | Out-Null
Invoke-Obsidian @("plugin:reload", "id=$PluginId") | Out-Null
Invoke-Obsidian @("command", "id=$PluginId`:open-daily-board") | Out-Null
Assert-FridayReady
Assert-NoDevErrors

Reset-FridayAuditState
$screenshots = @()

$screenshots += Run-Scenario "high-risk approval composer" @'
(()=>{const plugin=app.plugins.plugins["friday-obsidian-plugin"];
const view=app.workspace.getLeavesOfType("friday-daily-board")[0]?.view;
if(!plugin||!view) return "missing";
view.approvalQueue.clearWithDecision("deny");
plugin.workbenchStateStore.clearEditPlans();
view.aiConversation=[{role:"user",content:"检查本地状态",uiMeta:{conversationId:view.aiSessionId,turnId:"audit-approval-turn",taskId:"audit-approval-task"}}];
view.approvalQueue.enqueue({
  agentId:"audit-agent",
  tool:"exec",
  scope:"vault",
  targetPath:"",
  description:"FRIDAY 需要运行一个本地命令来检查结果。"
});
view.renderBoard();
return "pendingApprovals="+view.approvalQueue.list().length;
})()
'@ "01-high-risk-approval.png"

Reset-FridayAuditState
$screenshots += Run-Scenario "file mutation review composer" @'
(()=>{const plugin=app.plugins.plugins["friday-obsidian-plugin"];
const view=app.workspace.getLeavesOfType("friday-daily-board")[0]?.view;
if(!plugin||!view) return "missing";
const record={
  id:"audit-plan-current",
  agentId:"audit-agent",
  originConversationId:view.aiSessionId,
  originTurnId:"audit-turn",
  originTaskId:"audit-task",
  originTraceId:"audit-trace",
  tool:"write",
  recordedAt:new Date().toISOString(),
  items:[{
    path:"Audit/Test.md",
    changeType:"create",
    status:"pending",
    before:"",
    after:"# Audit",
    beforeHash:"",
    afterHash:"audit",
    summary:"已准备好文件修改，确认后才会写入 Obsidian。"
  }]
};
plugin.workbenchStateStore.recordEditPlan(record);
view.aiConversation=[{role:"user",content:"写入测试文件",uiMeta:{conversationId:view.aiSessionId,turnId:"audit-turn",taskId:"audit-task"}}];
view.renderBoard();
return "pendingEditPlans="+view.getPendingEditPlans().length;
})()
'@ "02-file-mutation-review.png"

Reset-FridayAuditState
Write-Host "Scenario: running process no-flicker"
$runningResult = Invoke-ObsidianEval @'
(() => new Promise(resolve=>{
const plugin=app.plugins.plugins["friday-obsidian-plugin"];
const view=app.workspace.getLeavesOfType("friday-daily-board")[0]?.view;
if(!plugin||!view){resolve("missing");return;}
view.aiConversation=[{role:"user",content:"整理运行过程",uiMeta:{conversationId:view.aiSessionId,turnId:"audit-running-turn",taskId:"audit-running-task"}}];
view.handleRuntimeProgress({phase:"model_request",depth:0,turnId:"audit-running-turn",taskId:"audit-running-task",conversationId:view.aiSessionId,agentId:"audit-agent",message:"Step 1: requesting model decision (native tools)",at:new Date().toISOString()});
view.handleRuntimeProgress({phase:"tool_call",depth:0,turnId:"audit-running-turn",taskId:"audit-running-task",conversationId:view.aiSessionId,agentId:"audit-agent",tool:"read",targetPath:"Audit/Test.md",message:"正在读取相关笔记",at:new Date().toISOString()});
view.renderBoard();
let processAdds=0,processRemoves=0;
const root=document.querySelector(".friday-daily-board");
const observer=new MutationObserver(records=>{
 for(const record of records){
  for(const node of record.addedNodes){ if(node.nodeType===1 && (node.matches?.(".friday-agent-process-shell") || node.querySelector?.(".friday-agent-process-shell"))) processAdds++; }
  for(const node of record.removedNodes){ if(node.nodeType===1 && (node.matches?.(".friday-agent-process-shell") || node.querySelector?.(".friday-agent-process-shell"))) processRemoves++; }
 }
});
observer.observe(root,{childList:true,subtree:true});
setTimeout(()=>{
 observer.disconnect();
 const process=document.querySelector(".friday-agent-process-shell.is-live");
 const animationName=process ? getComputedStyle(process).animationName : "";
 resolve(JSON.stringify({processAdds,processRemoves,animationName}));
},2300);
}))()
'@
Write-Host "  eval: $runningResult"
if ($runningResult -notmatch '"processAdds"\s*:\s*0' -or $runningResult -notmatch '"processRemoves"\s*:\s*0') {
	throw "Running process flicker check failed: $runningResult"
}
$screenshots += Capture-Screenshot "03-running-process-no-flicker.png"
Write-Host "  screenshot: $($screenshots[-1])"
$scan = Invoke-DomBannedScan
Write-Host "  DOM banned terms scan: $scan"
Assert-NoDevErrors

Reset-FridayAuditState
$screenshots += Run-Scenario "completed process folded" @'
(()=>{const plugin=app.plugins.plugins["friday-obsidian-plugin"];
const view=app.workspace.getLeavesOfType("friday-daily-board")[0]?.view;
if(!plugin||!view) return "missing";
const snapshot={
 identity:{conversationId:view.aiSessionId,turnId:"audit-completed-turn",taskId:"audit-completed-task",agentId:"audit-agent"},
 status:"completed",
 headline:"FRIDAY 已完成工作",
 summary:"结果已整理完成。",
 time:{startedAt:"2026-05-11T00:00:00.000Z",completedAt:"2026-05-11T00:00:05.000Z",durationMs:5000},
 stages:[],
 items:[
  {id:"tool",kind:"tool",title:"Read Audit/Test.md",detail:"已读取相关笔记。",status:"ok",targetPath:"Audit/Test.md"},
  {id:"final",kind:"final",title:"Final response",detail:"结果已整理完成。",status:"ok"}
 ],
 actions:[],
 mutations:[],
 privacy:{redacted:true,source:"replay"}
};
view.aiConversation=[
 {role:"user",content:"整理完成态",uiMeta:{conversationId:view.aiSessionId,turnId:"audit-completed-turn",taskId:"audit-completed-task"}},
 {role:"assistant",content:"结果已整理完成。",uiMeta:{conversationId:view.aiSessionId,turnId:"audit-completed-turn",taskId:"audit-completed-task"}}
];
view.rememberCompletedTrajectorySnapshot(snapshot);
view.renderBoard();
const expanded=document.querySelector(".friday-agent-process-toggle")?.getAttribute("aria-expanded");
return "completedExpanded="+expanded;
})()
'@ "04-completed-folded.png"

Reset-FridayAuditState
$screenshots += Run-Scenario "conflict waiting product copy" @'
(()=>{const plugin=app.plugins.plugins["friday-obsidian-plugin"];
const view=app.workspace.getLeavesOfType("friday-daily-board")[0]?.view;
if(!plugin||!view) return "missing";
const snapshot={
 identity:{conversationId:view.aiSessionId,turnId:"audit-conflict-turn",taskId:"audit-conflict-task",agentId:"audit-agent"},
 status:"waiting_for_user",
 headline:"等待你的补充",
 summary:"文件已在确认前发生变化，FRIDAY 需要重新检查这次修改。",
 time:{startedAt:"2026-05-11T00:00:00.000Z",updatedAt:"2026-05-11T00:00:04.000Z",durationMs:4000},
 stages:[],
 items:[
  {id:"mutation",kind:"mutation",title:"文件修改需要重新确认",detail:"文件已在确认前发生变化，FRIDAY 需要重新检查这次修改。",status:"failed",targetPath:"Audit/Test.md",rawEventType:"mutation_conflicted"}
 ],
 actions:[{id:"continue",label:"继续",enabled:true,targetId:"audit-conflict-task"}],
 mutations:[{id:"audit-plan-conflict",event:"conflicted",operation:"write",targetPath:"Audit/Test.md",status:"conflicted",summary:"文件已在确认前发生变化，FRIDAY 需要重新检查这次修改。",reason:"文件已在确认前发生变化，FRIDAY 需要重新检查这次修改。"}],
 privacy:{redacted:true,source:"live"}
};
view.aiConversation=[{role:"user",content:"处理冲突",uiMeta:{conversationId:view.aiSessionId,turnId:"audit-conflict-turn",taskId:"audit-conflict-task"}}];
view.aiRuntimeTrajectorySnapshot=snapshot;
view.bindRuntimeSnapshotToLatestUserMessage(snapshot);
view.renderBoard();
return "conflictWaiting";
})()
'@ "05-conflict-waiting-product-copy.png"

Write-Host "Screenshots:"
$screenshots | ForEach-Object { Write-Host "  $_" }
Write-Host "Final DOM banned terms scan: []"
Assert-NoDevErrors
