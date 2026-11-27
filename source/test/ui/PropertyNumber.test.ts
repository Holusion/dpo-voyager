import { expect } from "chai";

import PropertyNumber from "client/ui/properties/PropertyNumber";
import CVOrbitNavigation from "client/components/CVOrbitNavigation";

import { createDocumentData, createStory } from "../helpers/story";


describe("PropertyNumber", function(){
  let navigation: CVOrbitNavigation;
  let element: PropertyNumber;

  beforeEach(function(){
    navigation = createStory(createDocumentData([{ name: "Model" }])).document.setup.navigation;
  });

  afterEach(function(){
    element?.remove();
    element = null;
  });

  async function field(property: any, index?: number): Promise<HTMLInputElement>
  {
    element = document.createElement("sv-property-number") as PropertyNumber;
    element.property = property;
    if (index !== undefined) {
      element.index = index;
    }
    document.body.appendChild(element);
    await element.updateComplete;
    return element.querySelector("input");
  }

  async function enter(input: HTMLInputElement, text: string)
  {
    input.value = text;
    input.dispatchEvent(new Event("change"));
    await element.updateComplete;
  }

  it("resets a vector element to its preset when emptied", async function(){
    const maxOrbit = navigation.ins.maxOrbit;
    maxOrbit.setValue([ 45, 10, 20 ]);
    const input = await field(maxOrbit, 0);

    await enter(input, "");
    expect(maxOrbit.value).to.deep.equal([ maxOrbit.schema.preset[0], 10, 20 ]);
  });

  it("resets a scalar to its preset when emptied", async function(){
    const speed = navigation.ins.autoRotationSpeed;
    speed.setValue(42);
    const input = await field(speed);

    await enter(input, " ");
    expect(speed.value).to.equal(speed.schema.preset);
  });

  it("shows the default again when emptied while already at the default", async function(){
    const speed = navigation.ins.autoRotationSpeed;
    const input = await field(speed);
    const text = input.value;

    await enter(input, "");
    expect(input.value).to.equal(text);
  });
});
