
import CObject3D, { Node, types } from "@ff/scene/components/CObject3D";
import CScene from "@ff/scene/components/CScene";
import CVModel2 from "./CVModel2";
import CPulse, { IPulseContext, IPulseEvent } from "@ff/graph/components/CPulse";
import Component from "@ff/graph/Component";
import { EDerivativeQuality, EDerivativeUsage } from "client/schema/model";
import CRenderer from "@ff/scene/components/CRenderer";

interface ILOD{
  enabled?:boolean;
}

/**
 * Dynamic LOD handling. * 
 */
export default class CVDerivativesController extends Component{

  static readonly typeName: string = "CVDerivativesController";
  static readonly isSystemSingleton: boolean = true;

  static readonly text: string = "Derivatives selection";
  static readonly icon: string = "";

  protected static readonly ins = {
    enabled: types.Boolean("Settings.Enabled", true),
  }


  ins = this.addInputs<CObject3D, typeof CVDerivativesController.ins>(CVDerivativesController.ins);


  get settingProperties() {
    return [
        this.ins.enabled,
    ];
  }
  private _scene :CScene;
  protected get renderer() {
    return this.getMainComponent(CRenderer);
}
  get activeScene(){
    return this.renderer?.activeSceneComponent;
  }

  constructor(node: Node, id: string)
  {
      super(node, id);
      this._scene = this.activeScene;
  }


  tock(context :IPulseContext) :boolean{
    const cameraComponent = this._scene?.activeCameraComponent;
    if (!this.ins.enabled.value || !cameraComponent) {
        return false;
    }
    let changed = false;
    const models = this.getGraphComponents(CVModel2);

    for (let model of models){
      const current = model.ins.quality.value;
      const quality = EDerivativeQuality.High;
      if(quality === current) continue;
      const bestMatchDerivative = model.derivatives.select(EDerivativeUsage.Web3D, quality);
      if(bestMatchDerivative && bestMatchDerivative.data.quality != current ){
        //console.debug("Set quality for ", model.ins.name.value, " from ", current, " to ", bestMatchDerivative.data.quality);
        model.ins.quality.setValue(bestMatchDerivative.data.quality);
        changed = true;
      }
    }
    return changed;
  }
  
  fromData(data: ILOD)
    {
        data = data || {} as ILOD;

        this.ins.copyValues({
            enabled: !!data.enabled,
        });
    }

    toData(): ILOD
    {
        const ins = this.ins;
        const data: Partial<ILOD> = {};

        data.enabled = ins.enabled.value;
        
        return data as ILOD;
    }


}