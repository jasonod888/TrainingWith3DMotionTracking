# Commercial licensing review for lesson models

Reviewed 4 November 2026 against published upstream sources and local body-model license files. This is a review of published terms, not a legal opinion or a complete dependency audit.

## Decision

Commercial use is a required selection criterion. A paid SaaS product and models downloaded into learners' browsers are both in scope. Browser delivery redistributes model and runtime files, so license and attribution obligations apply to those files too.

Use official Basic Pitch for the initial music transcription baseline. Transkun's bundled checkpoint is a reasonable commercial candidate under the MIT distribution, with the scope inference documented below. Guitar-Transcription provides particularly clear evidence by licensing its separate weights repository under MIT. Keep candidates with unresolved artifact permissions out of production until those permissions are established.

No music model is currently installed by this proposal. These are selection decisions; exact releases, file hashes, dependency inventories, and shipped notices still need recording when implementation chooses artifacts.

## Music candidates

| Component | Code evidence | Weight evidence | Commercial-use decision |
| --- | --- | --- | --- |
| Spotify Basic Pitch | Apache 2.0 license and upstream NOTICE. | Official saved models are included in the same licensed distribution; README documents the included TF/CoreML/TFLite/ONNX models. No separate restrictive weight terms were found. | Suitable on published distribution terms. Use official bundled models; retain LICENSE, relevant NOTICE, and modification notices. |
| Spotify Basic Pitch TypeScript | Apache 2.0. | Official conversion of the Basic Pitch model; preserve provenance from the official model. | Suitable on published terms. Independently record the exact model files delivered to the browser. |
| Transkun | Full MIT license. | `transkun/pretrained/2.0.pt` is in the MIT repository; `setup.py` explicitly packages pretrained `.pt` and `.conf` files. | Suitable for the bundled distribution on the reasonable interpretation that the repository license covers its included checkpoint. This is a scope inference, not an explicit checkpoint-specific declaration. Do not extend this conclusion automatically to Google Drive checkpoints or third-party conversions. Obtain explicit author clarification if your release policy requires a weight-specific grant. |
| ErenReyhanlioglu/Guitar-Transcription | Full MIT license in code repository. | Separate Guitar-Transcription-Weights repository explicitly declares MIT and includes the full license. | Suitable on the published code and weight terms. Keep the exact checkpoint and license together. Performance suitability remains a separate question. |
| PitchPlease trained models | README and package metadata declare MIT. | Package includes models and vendored kernels, but an explicit weight/kernel licensing statement and complete upstream license trail were not established. Vendor manifest records hashes and source commits, which is useful provenance but not a permission grant. | Hold from production under the commercial-only requirement until the exact package's weights and vendored kernels have documented coverage and copyright notices. This does not establish that commercial use is prohibited. |
| AutoTab v2 | `pyproject.toml` declares MIT; a standalone LICENSE file was not found. This improves on the earlier exploration's finding. | Shipped legacy weights originate from an earlier project. Explicit grant and attribution coverage for those weights was not established. | Hold from production pending code/legacy-weight scope and notice clarification. A metadata label alone does not resolve the inherited artifacts. |
| ByteDance piano transcription | Upstream README declares Apache 2.0. | Official inference package downloads its checkpoint from Zenodo record 4034264. That record's license could not be verified in this review; the inference wrapper's license also needs confirmation. | Hold that deployment path pending the checkpoint and wrapper terms. Do not assume the code README licenses an external download. |
| Magenta MT3 | Apache 2.0 repository license. | Pretrained checkpoints are offered separately; explicit coverage for the exact checkpoint was not established. | Hold the checkpoints from production pending artifact terms. Code can be evaluated under Apache terms; not needed for the initial product. |
| Web MIDI | Browser API, not an AI model. | No model weights. | Use for compatible keyboards. Any parser or helper package added later has its own license. |

“Suitable” means the identified published grant supports commercial use, subject to its conditions. It is not a warranty of third-party rights, a full dependency clearance, or an approval of every file available under the same project name. “Hold” means unresolved evidence, not a finding of a non-commercial license.

### Primary evidence for the music decisions

- Basic Pitch: [LICENSE](https://github.com/spotify/basic-pitch/blob/main/LICENSE), [NOTICE](https://github.com/spotify/basic-pitch/blob/main/NOTICE), [official saved models](https://github.com/spotify/basic-pitch/tree/main/basic_pitch/saved_models), [distribution documentation](https://github.com/spotify/basic-pitch).
- Basic Pitch TS: [LICENSE](https://github.com/spotify/basic-pitch-ts/blob/main/LICENSE).
- Transkun: [MIT license](https://github.com/Yujia-Yan/Transkun/blob/main/LICENSE), [bundled checkpoint directory](https://github.com/Yujia-Yan/Transkun/tree/main/transkun/pretrained), [package inclusion rules](https://github.com/Yujia-Yan/Transkun/blob/main/setup.py), [external model cards](https://github.com/Yujia-Yan/Transkun#model-cards).
- Guitar-Transcription: [code license](https://github.com/ErenReyhanlioglu/Guitar-Transcription/blob/main/LICENSE), [weights repository and MIT declaration](https://github.com/ErenReyhanlioglu/Guitar-Transcription-Weights#license), [weights license text](https://github.com/ErenReyhanlioglu/Guitar-Transcription-Weights/blob/main/LICENSE).
- PitchPlease: [README license declaration](https://github.com/markusstrasser/pitchplease#license), [package license and included assets](https://github.com/markusstrasser/pitchplease/blob/master/package.json), [vendor manifest](https://github.com/markusstrasser/pitchplease/blob/master/engine/vendor.json). Attempts to retrieve a standalone LICENSE and a model README did not establish additional grants.
- AutoTab v2: [MIT metadata](https://github.com/chessfromthefuture/autotabv2/blob/master/pyproject.toml), [legacy-weight description](https://github.com/chessfromthefuture/autotabv2).
- ByteDance: [README license](https://github.com/bytedance/piano_transcription#license), [official inference wrapper and checkpoint link](https://github.com/qiuqiangkong/piano_transcription_inference). Zenodo access was unsuccessful; no license conclusion is inferred from Zenodo's default settings.
- MT3: [code license](https://github.com/magenta/mt3/blob/main/LICENSE), [pretrained inference entry point](https://github.com/magenta/mt3#transcribe-your-own-audio).

## Existing body pipeline and optional hand tracking

The current checkout also uses body-model components. These should not be represented as all having a permissive Apache license.

| Component | Evidence | Commercial-use interpretation |
| --- | --- | --- |
| SAM 3D Body | Local `models/sam-3d-body-dinov3/LICENSE`, retained provenance, and [official SAM license](https://github.com/facebookresearch/sam-3d-body/blob/main/LICENSE). | Custom SAM license grants use of code and weights and does not limit use to research/non-commercial purposes. Commercial lesson processing appears permitted subject to its conditions, including redistribution, use restrictions, and other custom provisions. This is not Apache or MIT. |
| DINOv3 | Local `models/torch/hub/facebookresearch_dinov3_main/LICENSE.md` and [official DINO license](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md). | Custom DINO terms likewise permit use without a research-only limitation, subject to their conditions. Preserve these separately from SAM and verify applicability to deployed artifacts. |
| MHR rig assets | Local `models/mhr/assets/LICENSE.txt` declares Apache 2.0. | Commercially usable under Apache terms for these specific assets; this does not license unrelated rigs, meshes, or textures. |
| SAM 2.1 segmentation | [Official repository licensing statement](https://github.com/facebookresearch/sam2#license) explicitly covers model checkpoints and code under Apache 2.0. | Suitable under Apache terms for the official checkpoint. Match the downloaded local file to that upstream release. |
| MediaPipe Pose and optional Hands | Official [BlazePose model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) and [Hand Tracking model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf) state Apache 2.0. | Suitable for the documented model families under Apache terms. Preserve the mapping from each exact Tasks bundle to its component cards and notices; a documentation-page footer is not a model license. |

This covers the principal model families found in the inspected pipeline, not every optional experiment, Python/browser dependency, binary, avatar, sample recording, or downloaded asset in the workspace.

## Conditions for a commercial release

[MIT](https://opensource.org/license/mit) permits commercial use and sale while requiring preservation of the copyright and permission notice in copies or substantial portions. It does not require publishing the proprietary application's source.

[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) permits commercial use and distribution with license preservation, relevant notices, and identification of modified files. It includes an express patent grant with conditions and does not grant trademark endorsement rights. Keep Basic Pitch's upstream NOTICE and relevant third-party notices. A browser bundle/model download counts as distribution; a server-only model is a different distribution arrangement, not an escape from its license conditions.

Record component name, exact version/commit, original download URL, file SHA-256, code and weight license, vendored-runtime license, required notices, and server/browser distribution mode in the release inventory. Converted, quantized, or fine-tuned weights retain applicable upstream obligations; changing the format does not erase them. Do not add training-only packages or source-separation models to the deployment without reviewing their actual artifacts.

Training-data permissions and model permissions are separate questions. [MAESTRO](https://magenta.withgoogle.com/datasets/maestro) is published under CC BY-NC-SA 4.0. Do not assume permission to download it for commercial training or evaluation. Conversely, that fact alone does not establish that every independently released model trained on it has the same license. Assess each model's published grant and unresolved provenance individually.

Music-model licenses do not grant rights to instructors' recordings, compositions, commercial backing tracks, instrument samples, or lesson redistribution. Use authorized recordings and properly licensed synthesis/samples. Those are content rights separate from model selection.

## Changes to the proposed music plan

Basic Pitch remains the default transcription baseline for both instruments. Transkun stays a piano comparison candidate using only the bundled distribution and the documented MIT-scope interpretation. Guitar-Transcription remains an optional tab research candidate with a clear MIT weight grant.

PitchPlease is no longer an unconditional production recommendation: validate its artifact licensing before selecting it for live microphone coaching. Start live piano feedback with Web MIDI while that is resolved. If it remains unresolved, evaluate another detector with explicit code, runtime, and weight grants, or develop restricted monophonic detection with commercially usable DSP libraries. Do not promise production polyphonic microphone feedback until both licensing and performance pass.

No maintainers have been contacted, licenses purchased, new packages installed, or production settings changed as part of this review.
