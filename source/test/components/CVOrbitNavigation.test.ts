import { expect } from "chai";

import CVOrbitNavigation from "client/components/CVOrbitNavigation";
import CVScene from "client/components/CVScene";
import CVCamera from "client/components/CVCamera";
import { IDocument } from "client/schema/document";

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

    it("sets the far plane beyond the maximum zoom distance", function(){
      const camera = story.document.getInnerComponent(CVCamera);
      const { max } = navigation.effectiveOffsetLimits;
      expect(camera.ins.far.value).to.be.at.least(max[2] + radius());
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
