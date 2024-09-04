/**
 * FF Typescript Foundation Library
 * Copyright 2020 Ralph Wiedemeier, Frame Factory GmbH
 *
 * License: MIT
 */

import {
  Object3D,
  LineSegments,
  LineBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  Matrix4,
  Box3,
  Color,
  Points,
  PointsMaterial,
} from "three";

import { computeLocalBoundingBox } from "./helpers";

////////////////////////////////////////////////////////////////////////////////

const _vec3 = new Vector3();
const _mat4 = new Matrix4();

export interface IBracketProps
{
  /** Color of the bracket. */
  color?: Color;
  /** Size of the point */
  length?: number;
}

/**
* Wireframe selection bracket.
*/
export default class Origin extends Points
{
  static readonly defaultProps = {
      color: new Color("#d6b018"),
      size: 3
  };

  constructor(target: Object3D, props?: IBracketProps)
  {4
    props = Object.assign({}, Origin.defaultProps, props);


    const dotGeometry = new BufferGeometry();
    dotGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    const dotMaterial = new PointsMaterial({ ...props, sizeAttenuation: false, depthTest: false });
    super(dotGeometry, dotMaterial);

    this.renderOrder = 1;
  }

  dispose()
  {
      if (this.parent) {
          this.parent.remove(this);
      }

      this.geometry.dispose();
  }

}