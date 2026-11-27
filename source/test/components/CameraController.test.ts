import { expect } from "chai";
import { Box3, Vector3 } from "three";

import CameraController, { EControllerMode } from "@ff/three/CameraController";
import UniversalCamera from "@ff/three/UniversalCamera";


describe("CameraController", function(){
  let controller: CameraController;

  beforeEach(function(){
    controller = new CameraController();
    controller.camera = new UniversalCamera();
    controller.orbit.set(0, 0, 0);
  });

  describe("applyLimits()", function(){
    it("clamps orbit and offset", function(){
      controller.minOffset.set(-1, -1, 0.5);
      controller.maxOffset.set(1, 1, 10);
      controller.offset.set(5, -5, 0.1);
      controller.orbit.set(-120, 0, 0);
      controller.applyLimits();
      expect(controller.offset.toArray()).to.deep.equal([1, -1, 0.5]);
      expect(controller.orbit.x).to.equal(-90);
    });

    it("does not clamp the offset outside of orbit mode", function(){
      controller.controllerMode = EControllerMode.Fly;
      controller.offset.set(0, 0, 10000);
      controller.applyLimits();
      expect(controller.offset.z).to.equal(10000);
    });
  });

  describe("zoomExtents()", function(){
    // a small object, ~1cm across (like a scene authored in meters with a tiny model)
    const box = new Box3(new Vector3(-0.005, -0.005, -0.005), new Vector3(0.005, 0.005, 0.005));

    it("frames the box when limits allow it", function(){
      controller.minOffset.set(-Infinity, -Infinity, 0.0001);
      controller.zoomExtents(box);
      expect(controller.offset.z).to.be.above(0.0001).and.below(0.1);
    });

    it("does not zoom closer than minOffset.z", function(){
      controller.minOffset.set(-Infinity, -Infinity, 0.1);
      controller.zoomExtents(box);
      expect(controller.offset.z).to.equal(0.1);
    });

    it("keeps the framing center within the x/y offset limits", function(){
      const offCenter = box.clone().translate(new Vector3(1, -1, 0));
      controller.minOffset.set(0, 0, 0.0001);
      controller.maxOffset.set(0.5, 0.5, Infinity);
      controller.zoomExtents(offCenter);
      expect(controller.offset.x).to.equal(0.5);
      expect(controller.offset.y).to.equal(0);
    });

    it("is not moved by a subsequent interaction", function(){
      controller.minOffset.set(-Infinity, -Infinity, 0.1);
      controller.zoomExtents(box);
      const before = controller.offset.clone();
      // a pure orbit gesture still clamps the offset in updatePose()
      (controller as any).updatePose(0, 0, 1, 10, 10, 0);
      expect(controller.offset.toArray()).to.deep.equal(before.toArray());
    });
  });
});
