param([string]$CredentialFile='.local/worker.env',[switch]$Once,[switch]$Detach)
$ErrorActionPreference='Stop'
$formWorkerRoot=Split-Path $PSScriptRoot -Parent
Set-Location $formWorkerRoot
$formWorkerCredentials=(Resolve-Path -LiteralPath $CredentialFile).Path
docker image inspect form-saas-gpu:latest --format '{{.Id}}'
if($LASTEXITCODE){throw 'Build the GPU image first: docker build -f infra/docker/Dockerfile.gpu -t form-saas-gpu .'}
$formWorkerArgs=@('run','--name','form-conversion-worker','--gpus','all','--user','10001:10001','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','12g','--pids-limit','256','--read-only','--tmpfs','/tmp:rw,size=536870912','--env-file',$formWorkerCredentials,'-e','PYTHONDONTWRITEBYTECODE=1','-e','OMP_NUM_THREADS=4',
 '--mount',"type=bind,source=$formWorkerRoot/models,target=/app/models,readonly",'--mount',"type=bind,source=$formWorkerRoot/scripts,target=/app/scripts,readonly",'--mount',"type=bind,source=$formWorkerRoot/outputs,target=/app/outputs")
if($Detach){$formWorkerArgs+=@('-d','--restart','unless-stopped')}else{$formWorkerArgs+='--rm'}
$formWorkerArgs+=@('form-saas-gpu:latest','python','scripts/saas_worker.py')
if($Once){$formWorkerArgs+='--once'}
& docker @formWorkerArgs
if($LASTEXITCODE){throw 'The local conversion worker failed to start or stopped with an error.'}
