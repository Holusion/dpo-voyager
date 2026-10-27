import { expect } from "chai";

import System from "@ff/graph/System";
import CSelection from "@ff/graph/components/CSelection";
import CVTask from "client/components/CVTask";
import CVDerivativesTask from "client/components/CVDerivativesTask";
import CVTaskProvider, { IActiveTaskEvent } from "client/components/CVTaskProvider";


/** Steps of every synthetic task, in order: "start A", "stop A"... */
let log :string[];

interface ISyntheticTask {
  label :string;
  onStart :() => void;
  onStop :() => void;
}

/**
 * Tasks that only record when they start and stop, so the provider is tested on its own.
 * `onStart` and `onStop` run in the middle of a start or stop, e.g. to throw.
 */
function synthetic<T extends new (...args :any[]) => CVTask>(Base :T){
  return class extends Base implements ISyntheticTask {
    label = "";
    onStart = () => {};
    onStop = () => {};

    activateTask(){
      log.push(`start ${this.label}`);
      this.outs.isActive.setValue(true);
      this.onStart();
    }

    deactivateTask(){
      log.push(`stop ${this.label}`);
      this.outs.isActive.setValue(false);
      this.onStop();
    }
  };
}

class TestTask extends synthetic(CVTask){
  static readonly typeName :string = "TestTask";
}

class TestAssetsTask extends synthetic(CVDerivativesTask){
  static readonly typeName :string = "TestAssetsTask";
}

describe("CVTaskProvider", function(){
  let system :System;
  let tasks :CVTaskProvider;
  let a :TestTask, b :TestTask, assets :TestAssetsTask;

  /** Tasks whose last step was a start. */
  const running = () => [a, b, assets].filter(task => task.outs.isActive.value).map(task => task.label);

  beforeEach(function(){
    log = [];
    system = new System();
    system.registry.add([CSelection, CVTaskProvider, TestTask, TestAssetsTask]);
    system.graph.createNode("Main").createComponent(CSelection);
    const node = system.graph.createNode("Tasks");
    tasks = node.createComponent(CVTaskProvider);
    a = node.createComponent(TestTask);
    b = node.createComponent(TestTask);
    assets = node.createComponent(TestAssetsTask);
    [a.label, b.label, assets.label] = ["A", "B", "Assets"];
  });

  describe("one task at a time", function(){
    it("starts the active task", function(){
      tasks.activeComponent = a;
      expect(log).to.deep.equal(["start A"]);
      expect(running()).to.deep.equal(["A"]);
    });

    it("stops the running task before starting the next one", function(){
      tasks.activeComponent = a;
      tasks.activeComponent = b;
      tasks.activeComponent = null;
      expect(log).to.deep.equal(["start A", "stop A", "start B", "stop B"]);
      expect(running()).to.deep.equal([]);
    });

    it("starts a task once when it's set active again", function(){
      tasks.activeComponent = a;
      tasks.activeComponent = a;
      expect(log).to.deep.equal(["start A"]);
    });

    it("starts a selected task", function(){
      system.getComponent(CSelection).selectComponent(a);
      expect(tasks.activeComponent).to.equal(a);
      expect(log).to.deep.equal(["start A"]);
    });

    it("runs the Assets task in place of the active task while the Assets tab is shown", function(){
      tasks.activeComponent = a;
      tasks.assetsPanelActive = true;
      expect(running()).to.deep.equal(["Assets"]);
      expect(tasks.activeComponent).to.equal(a);
      tasks.assetsPanelActive = true;
      tasks.assetsPanelActive = false;
      expect(log).to.deep.equal(["start A", "stop A", "start Assets", "stop Assets", "start A"]);
      expect(running()).to.deep.equal(["A"]);
    });

    it("closes the Assets tab when another task becomes active", function(){
      tasks.activeComponent = a;
      tasks.assetsPanelActive = true;
      tasks.activeComponent = b;
      expect(log).to.deep.equal(["start A", "stop A", "start Assets", "stop Assets", "start B"]);
      expect(tasks.assetsPanelActive).to.be.false;
    });

    it("closes the Assets tab when the active task closes", function(){
      tasks.activeComponent = a;
      tasks.assetsPanelActive = true;
      tasks.activeComponent = null;
      expect(log).to.deep.equal(["start A", "stop A", "start Assets", "stop Assets"]);
      expect(tasks.assetsPanelActive).to.be.false;
    });

    it("stops a running task once when the task is disposed", function(){
      tasks.activeComponent = a;
      a.dispose();
      expect(log).to.deep.equal(["start A", "stop A"]);
      expect(tasks.activeComponent).to.be.null;
      tasks.activeComponent = b;
      expect(log).to.deep.equal(["start A", "stop A", "start B"]);
    });

    it("resumes the active task when the running Assets task is disposed", function(){
      tasks.activeComponent = a;
      tasks.assetsPanelActive = true;
      assets.dispose();
      expect(log).to.deep.equal(["start A", "stop A", "start Assets", "stop Assets", "start A"]);
      expect(tasks.assetsPanelActive).to.be.false;
    });

    it("stops the running task when disposed", function(){
      tasks.activeComponent = a;
      tasks.assetsPanelActive = true;
      tasks.dispose();
      expect(log).to.deep.equal(["start A", "stop A", "start Assets", "stop Assets"]);
      expect(running()).to.deep.equal([]);
    });
  });

  describe("no task half-open", function(){
    /** Expects that nothing runs, nothing is selected and the Assets tab is closed. */
    const expectClosed = function(){
      expect(running()).to.deep.equal([]);
      expect(tasks.activeComponent).to.be.null;
      expect(tasks.assetsPanelActive).to.be.false;
    };

    it("stops a task that fails to start, and selects none", function(){
      tasks.activeComponent = a;
      b.onStart = () => { throw new Error("B can't start"); };
      const events :string[] = [];
      tasks.on<IActiveTaskEvent>("active-component", event => events.push((event.next as TestTask)?.label ?? "none"));

      expect(() => tasks.activeComponent = b).to.throw("B can't start");
      expect(log).to.deep.equal(["start A", "stop A", "start B", "stop B"]);
      expectClosed();
      expect(events).to.deep.equal(["none"]);
    });

    it("reports the start failure when stopping the failed task fails too", function(){
      a.onStart = () => { throw new Error("A can't start"); };
      a.onStop = () => { throw new Error("A can't stop"); };
      const consoleError = console.error;
      const reported :unknown[] = [];
      console.error = error => reported.push(error);
      try {
        expect(() => tasks.activeComponent = a).to.throw("A can't start");
      }
      finally {
        console.error = consoleError;
      }
      expect(reported.map(error => (error as Error).message)).to.deep.equal(["A can't stop"]);
      expectClosed();
    });

    it("considers a task that fails to stop as stopped", function(){
      tasks.activeComponent = a;
      a.onStop = () => { throw new Error("A can't stop"); };

      expect(() => tasks.activeComponent = b).to.throw("A can't stop");
      expect(log).to.deep.equal(["start A", "stop A"]);
      expectClosed();

      tasks.activeComponent = b;
      expect(log).to.deep.equal(["start A", "stop A", "start B"]);
    });

    it("closes the Assets tab when the Assets task fails to start", function(){
      tasks.activeComponent = a;
      assets.onStart = () => { throw new Error("Assets can't start"); };

      expect(() => tasks.assetsPanelActive = true).to.throw("Assets can't start");
      expect(log).to.deep.equal(["start A", "stop A", "start Assets", "stop Assets"]);
      expectClosed();
    });

    it("selects no task when the active task fails to resume after the Assets tab", function(){
      tasks.activeComponent = a;
      tasks.assetsPanelActive = true;
      a.onStart = () => { throw new Error("A can't start"); };

      expect(() => tasks.assetsPanelActive = false).to.throw("A can't start");
      expectClosed();
    });

    it("rejects a task switch while a task starts", function(){
      a.onStart = () => { tasks.activeComponent = b; };

      expect(() => tasks.activeComponent = a).to.throw("can't switch tasks while a task starts or stops");
      expect(log).to.deep.equal(["start A", "stop A"]);
      expectClosed();
    });

    it("rejects a task switch while a task stops", function(){
      tasks.activeComponent = a;
      a.onStop = () => { tasks.assetsPanelActive = true; };

      expect(() => tasks.activeComponent = b).to.throw("can't switch tasks while a task starts or stops");
      expect(log).to.deep.equal(["start A", "stop A"]);
      expectClosed();
    });

    it("lets a listener switch tasks once a switch is done", function(){
      tasks.on<IActiveTaskEvent>("active-component", event => {
        if (event.next === a) {
          tasks.activeComponent = b;
        }
      });

      tasks.activeComponent = a;
      expect(log).to.deep.equal(["start A", "stop A", "start B"]);
      expect(tasks.activeComponent).to.equal(b);
      expect(running()).to.deep.equal(["B"]);
    });
  });
});
