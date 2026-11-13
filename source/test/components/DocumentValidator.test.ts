import { expect } from "chai";

import type { ValidationResult } from "client/io/validateDocument";
import defaultDocument from "client/templates/default.svx.json";


describe("validateDocument", function(){
  function withOrbit(orbit: any)
  {
    const document = JSON.parse(JSON.stringify(defaultDocument));
    Object.assign(document.setups[0].navigation.orbit, orbit);
    return document;
  }

  // validateDocument is a web worker script: it installs a global onmessage handler
  // and answers through the global postMessage. Stub both to drive it synchronously.
  let lastResult: ValidationResult | null;
  let validate: (document: any) => boolean;

  this.beforeAll(async function(){
    const g = globalThis as any;
    g.onmessage = null;
    g.postMessage = (result: ValidationResult) => { lastResult = result; };
    await import("client/io/validateDocument");
    const handler = g.onmessage;
    expect(handler).to.be.a("function");
    validate = (document) => {
      lastResult = null;
      handler({ data: document });
      expect(lastResult, "worker did not reply").to.not.be.null;
      return lastResult.error === null;
    };
  });

  this.afterAll(function(){
    const g = globalThis as any;
    delete g.onmessage;
    delete g.postMessage;
  });

  it("validates the default document", function(){
    expect(validate(defaultDocument)).to.be.true;
  });

  it("validates an orbit pivot", function(){
    expect(validate(withOrbit({ pivot: [ 1, 2, 3 ] }))).to.be.true;
  });

  it("rejects malformed orbit values", function(){
    expect(validate(withOrbit({ pivot: [ 1, 2 ] }))).to.be.false;
    expect(validate(withOrbit({ pivot: [ 1, null, 3 ] }))).to.be.false;
    expect(validate(withOrbit({ minOrbit: [ "a", null, null ] }))).to.be.false;
  });
});
