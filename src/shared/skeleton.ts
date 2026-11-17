// The skeleton format every module speaks: OpenPose / COCO body-18 keypoints. The scene poses bodies in it, the
// camera projects and draws it, the evaluation reads it. A format, not anyone's logic, so it lives here.

/** Keypoint indices (OpenPose body-18; "neck" is the shoulders' midpoint). */
export const KP = {
  nose: 0, neck: 1, rShoulder: 2, rElbow: 3, rWrist: 4, lShoulder: 5, lElbow: 6, lWrist: 7,
  rHip: 8, rKnee: 9, rAnkle: 10, lHip: 11, lKnee: 12, lAnkle: 13, rEye: 14, lEye: 15, rEar: 16, lEar: 17,
} as const;
/** Bones as drawn in an OpenPose skeleton. */
export const BONES: [number, number][] = [
  [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];
/** The head's keypoints. */
export const HEAD: number[] = [KP.nose, KP.rEye, KP.lEye, KP.rEar, KP.lEar];
