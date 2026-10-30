# Local Docker data relocation — 30 October 2026

The user explicitly approved moving Docker data to D: after declining cloud resources for now.

The move used Docker Desktop **Settings → Resources → Advanced → Disk image location → Apply & restart → Yes, move it**. Docker selected the subdirectory `DockerDesktopWSL` beneath the approved parent folder.

| Item | Before | After |
| --- | --- | --- |
| Docker WSL directory | `C:\Users\enqui\AppData\Local\Docker\wsl` | `D:\DockerData\DockerDesktopWSL` |
| Data disk | `wsl\disk\docker_data.vhdx` on C: | `DockerDesktopWSL\disk\docker_data.vhdx` on D: |
| Docker setting | `CustomWslDistroDir` on C: | `CustomWslDistroDir` on D: |
| C: free immediately after move | Less than 1 GB before move | Approximately 15.8 GB after move; fluctuates with Windows/WSL activity |

The old data disk no longer exists at its C: location. Docker's native UI displays the D: location and a running engine. All six image IDs and all three volume names recorded before relocation were present immediately afterward, including the user's unrelated Blender/AnythingLLM images and pre-existing volume. No factory reset, volume deletion, pruning, or Windows security setting change was performed.

The two newly stale runtime socket folders were preserved with `.relocation-backup-20261030` suffixes before startup. These contain runtime sockets, not container images or volumes. Previous `.phase0-backup-20261030` runtime backups were also retained.

After relocation:

- PostgreSQL's existing `0001` migration remained present and readable.
- The CPU application image imported its libraries and started as non-root user `form`.
- Real database row/revision round trips passed.
- Private object storage and signed downloads passed checksum and anonymous-access denial checks.
- Database records and objects survived service restarts.
- The application's liveness remained healthy during a storage outage; readiness returned 503 and recovered when storage returned.

The service launcher now detects the Docker data drive instead of assuming C:. Cloud projects and resources remain untouched.
