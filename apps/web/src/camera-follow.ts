import {Vector3, type Camera} from 'three';

/** Move eye and target together; changing only the target rotates a stationary eye. */
export function followHorizontal(camera: Camera, target: Vector3, point: Vector3,
  previous: Vector3, ready: boolean) {
  const origin = ready ? previous : target;
  const delta = new Vector3(point.x-origin.x, 0, point.z-origin.z);
  camera.position.add(delta);
  target.add(delta);
  previous.copy(point);
}
