import {div,image} from "gpui-kit";
import {art} from "./theme-tokens.js";
import {deckGeometry} from "./deck-layout.js";

// Every slice shares one uniform image scale. Only the quiet beam repeats;
// the illustrated end caps keep their original geometry and transparency.
export function hangarDeck(width,height,t) {
  const g=deckGeometry(width,height),source=art("mods/crew/art/hangar-deck.png",t);
  return div().relative().w(g.width).h(g.height).overflow_hidden().children(g.pieces.map(piece=>
    div().absolute().left(piece.clipX).top(g.top).w(piece.clipWidth).h(g.drawHeight).overflow_hidden()
      .child(image(source).absolute().left(piece.imageLeft).top(-g.sourceY).w(g.imageWidth).h(g.imageHeight))));
}

export function lightHangarFace(t,header) {
  return div().absolute().top(header).bottom(0).left(0).right(0).bg(t.surface)
    .child(div().absolute().top(0).left(8).right(8).h(1).bg(t.border))
    .child(div().absolute().top(4).bottom(4).left(8).w(1).bg(t.rail).opacity(.45))
    .child(div().absolute().top(4).bottom(4).right(8).w(1).bg(t.rail).opacity(.45))
    .child(div().absolute().top(1).left(12).w(24).h(1).bg(t.accent));
}
