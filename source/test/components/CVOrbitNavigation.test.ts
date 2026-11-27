import { expect } from "chai";

import CVOrbitNavigation from "client/components/CVOrbitNavigation";
import CVScene from "client/components/CVScene";
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
      expect(max[2]).to.be.above(offsetZ());
    });

    it("keeps the auto zoom framing within the derived limits", function(){
      const { min, max } = navigation.effectiveOffsetLimits;
      expect(offsetZ()).to.be.above(min[2]).and.below(max[2]);
      expect(offsetZ()).to.be.below(0.1);
    });

    it("saves limits as unset", function(){
      const orbit = story.document.deflateDocument().setups[0].navigation.orbit;
      expect(orbit.minOffset).to.deep.equal([ null, null, null ]);
    });
  });

  describe("with authored limits", function(){
    it("does not zoom closer than an authored minOffset", function(){
      // as saved by the former default template, ~10x the object size
      load(createSmallObjectDocument({ minOffset: [ null, null, 0.1 ] }));
      expect(navigation.effectiveOffsetLimits.min[2]).to.equal(0.1);
      expect(offsetZ()).to.equal(0.1);
    });

    it("clamps an offset set from outside the controller", function(){
      load(createSmallObjectDocument({ minOffset: [ null, null, 0.1 ], maxOffset: [ null, null, 1 ] }));
      navigation.ins.offset.setValue([ 0, 0, 50 ]);
      story.update();
      story.update();
      expect(offsetZ()).to.equal(1);
    });
  });
});
