import { expect } from "chai";
import { Vector3 } from "three";

import CVOrbitNavigation from "client/components/CVOrbitNavigation";
import CVScene from "client/components/CVScene";
import CVCamera from "client/components/CVCamera";
import { IDocument } from "client/schema/document";

import { UNLIMITED } from "client/ui/properties/PropertyNumber";
import { EProjection } from "@ff/three/UniversalCamera";

import { createDocumentData, createStory, IStory } from "../helpers/story";


/**
 * A document with a single small model (~0.01 scene units across),
 * using the given navigation limits.
 */
function createSmallObjectDocument(limits: { minOffset?: number[], maxOffset?: number[] } = {}): IDocument
{
  const data = createDocumentData([{ name: "sherd", units: "cm" }]);
  // like the reported scene: model and scene in cm, the object being ~0.01 units across
  data.models[0].boundingBox = { min: [ -0.005, -0.006, 0 ], max: [ 0.002, 0.005, 0.008 ] };
  const orbit = data.setups[0].navigation.orbit;
  orbit.minOffset = limits.minOffset ?? [ null, null, null ];
  orbit.maxOffset = limits.maxOffset ?? [ null, null, null ];
  return data;
}

describe("CVOrbitNavigation", function(){
  let story: IStory;
  let navigation: CVOrbitNavigation;

  function load(data: IDocument)
  {
    story = createStory(data);
    navigation = story.document.setup.navigation;
    for (let i = 0; i < 5; ++i) {
      story.update();
    }
  }

  const offsetZ = () => navigation.ins.offset.value[2];
  const far = () => story.document.getInnerComponent(CVCamera).ins.far.value;
  const radius = () => story.document.getInnerComponent(CVScene).outs.boundingRadius.value;

  describe("with unset limits", function(){
    beforeEach(function(){
      load(createSmallObjectDocument());
    });

    it("derives zoom limits from the scene size", function(){
      const { min, max } = navigation.effectiveOffsetLimits;
      expect(radius()).to.be.above(0).and.below(0.01);
      expect(min[2]).to.be.closeTo(0.1 * radius(), 1e-9);
      expect(max[2]).to.be.a("number").and.above(offsetZ());
      expect(Number.isFinite(max[2])).to.be.true;
    });

    it("keeps the auto zoom framing within the derived limits", function(){
      const { min, max } = navigation.effectiveOffsetLimits;
      expect(offsetZ()).to.be.above(min[2]).and.below(max[2]);
      expect(offsetZ()).to.be.below(0.1);
    });

    it("saves limits as unset", function(){
      const orbit = story.document.deflateDocument().setups[0].navigation.orbit;
      expect(orbit.minOffset).to.deep.equal([ null, null, null ]);
      expect(orbit.maxOffset).to.deep.equal([ null, null, null ]);
    });

    it("keeps the scene within the far plane when zooming out to the maximum", function(){
      const { max } = navigation.effectiveOffsetLimits;
      navigation.ins.offset.setValue([ 0, 0, max[2] ]);
      story.update();
      story.update();
      expect(offsetZ()).to.equal(max[2]);
      expect(far()).to.be.at.least(offsetZ() + radius());
    });
  });

  describe("with authored limits", function(){
    it("does not zoom closer than an authored minOffset", function(){
      // as saved by the former default template, ~10x the object size
      load(createSmallObjectDocument({ minOffset: [ null, null, 0.1 ] }));
      const { min, max } = navigation.effectiveOffsetLimits;
      expect(min[2]).to.equal(0.1);
      expect(offsetZ()).to.equal(0.1);
      // the derived max and the far plane still contain the camera and the object
      expect(max[2]).to.be.above(0.1);
      const camera = story.document.getInnerComponent(CVCamera);
      expect(camera.ins.far.value).to.be.above(offsetZ() + radius());
    });

    it("lets an authored minOffset win over an inconsistent authored maxOffset", function(){
      load(createSmallObjectDocument({ minOffset: [ null, null, 0.1 ], maxOffset: [ null, null, 0.05 ] }));
      expect(navigation.effectiveOffsetLimits.max[2]).to.equal(0.1);
      expect(offsetZ()).to.equal(0.1);
    });

    it("does not zoom farther than an authored maxOffset, and keeps it", function(){
      load(createSmallObjectDocument({ maxOffset: [ null, null, 0.005 ] }));
      expect(navigation.effectiveOffsetLimits.max[2]).to.equal(0.005);
      expect(offsetZ()).to.equal(0.005);
      expect(navigation.ins.maxOffset.value[2]).to.equal(0.005);
    });

    it("clamps an offset set from outside the controller", function(){
      load(createSmallObjectDocument({ minOffset: [ null, null, 0.1 ], maxOffset: [ null, null, 1 ] }));
      navigation.ins.offset.setValue([ 0, 0, 50 ]);
      story.update();
      story.update();
      expect(offsetZ()).to.equal(1);
    });
  });

  describe("with an unlimited maxOffset", function(){
    beforeEach(function(){
      load(createSmallObjectDocument({ maxOffset: [ null, null, UNLIMITED ] }));
    });

    it("is saved and reloaded as an authored limit", function(){
      expect(navigation.effectiveOffsetLimits.max[2]).to.equal(UNLIMITED);
      const data = story.document.deflateDocument();
      expect(data.setups[0].navigation.orbit.maxOffset).to.deep.equal([ null, null, UNLIMITED ]);
      data.models.forEach(model => delete model.boundingBox);
      load(data);
      expect(navigation.effectiveOffsetLimits.max[2]).to.equal(UNLIMITED);
    });

    it("lets the far plane follow the camera instead of the maximum", function(){
      const farAt = (distance: number) => {
        navigation.ins.offset.setValue([ 0, 0, distance ]);
        story.update();
        story.update();
        expect(offsetZ()).to.equal(distance);
        expect(far()).to.be.at.least(distance + radius());
        return far();
      };
      const r = radius();
      // far from the object, the far plane stays within a few times the camera distance
      expect(farAt(1e6 * r)).to.be.below(1e7 * r);
      // and comes back when zooming in again
      expect(farAt(r)).to.be.below(10 * r);
    });
  });

  describe("with an orthographic camera", function(){
    function cameraDistance()
    {
      const camera = story.document.getInnerComponent(CVCamera);
      return new Vector3().setFromMatrixPosition(camera.transform.object3D.matrix).length();
    }

    for (const [ name, maxOffset ] of [
      [ "unset", [ null, null, null ] ],
      [ "unlimited", [ null, null, UNLIMITED ] ],
    ] as [ string, number[] ][]) {
      it(`places the camera at the automatic max distance with an ${name} maxOffset`, function(){
        load(createSmallObjectDocument({ maxOffset }));
        // as the projection toggle does
        navigation.ins.projection.setValue(EProjection.Orthographic);
        for (let i = 0; i < 3; ++i) {
          story.update();
        }
        const camera = story.document.getInnerComponent(CVCamera).camera;
        expect(camera.isOrthographicCamera).to.be.true;

        // outside of the scene, but in the scene's order of magnitude
        expect(cameraDistance()).to.be.above(2 * radius()).and.below(1);
        expect(camera.far).to.be.at.least(cameraDistance() + radius()).and.below(2);
      });
    }
  });

  describe("without a navigation section", function(){
    // the navigation's fromData doesn't run: the derived limits can't rely on it
    for (const [ name, edit ] of [
      [ "in the setup", (data: IDocument) => { delete data.setups[0].navigation; } ],
      [ "nor a setup", (data: IDocument) => { data.setups[0] = {} as any; } ],
    ] as [ string, (data: IDocument) => void ][]) {
      it(`keeps the preset camera offset (${name})`, function(){
        const data = createDocumentData([{ name: "Model" }]);
        edit(data);
        load(data);
        expect(navigation.ins.offset.value).to.deep.equal(navigation.ins.offset.schema.preset);
        expect(navigation.effectiveOffsetLimits.max[2]).to.be.above(offsetZ());
      });
    }
  });
});
