import { View } from "gpui-kit";
import { props, closeOverlay, run } from "herdr";
import { notificationCard } from "./card.js";

export default class NeonToast extends View {
  render() {
    const p = props() ?? {};
    return notificationCard(p, {
      activate: () => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      },
      dismiss: () => closeOverlay(p.overlay),
    });
  }
}
