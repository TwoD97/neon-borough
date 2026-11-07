// Transparent source canvas and measured hardware bounds supplied with the art.
const SOURCE={width:1263,height:1246,top:592,stripHeight:79,left:11,leftWidth:169,right:1090,rightWidth:162,tile:330,tileWidth:110};

export function deckGeometry(width,height) {
  const w=Math.max(1,Number(width)||1),h=Math.max(1,Number(height)||1);
  // Very narrow docks reduce both axes uniformly so both end caps still fit.
  const scale=Math.min(h/SOURCE.stripHeight,w/(SOURCE.leftWidth+SOURCE.rightWidth));
  const leftWidth=SOURCE.leftWidth*scale,rightWidth=SOURCE.rightWidth*scale;
  const middle=Math.max(0,w-leftWidth-rightWidth),tileWidth=SOURCE.tileWidth*scale;
  const pieces=[{x:0,width:leftWidth,sourceX:SOURCE.left*scale}];
  for(let used=0;used<middle-.001;used+=tileWidth) {
    pieces.push({x:leftWidth+used,width:Math.min(tileWidth,middle-used),sourceX:SOURCE.tile*scale});
  }
  pieces.push({x:w-rightWidth,width:rightWidth,sourceX:SOURCE.right*scale});
  // Fractional native clip edges can reveal a hairline of the surface below.
  // Bleed adjacent samples across that edge while preserving their world-space
  // image origin. Outer bounds and the image's uniform scale remain unchanged.
  for(const piece of pieces) {
    const leftBleed=Math.min(1,piece.x),rightBleed=Math.min(1,w-piece.x-piece.width);
    piece.clipX=piece.x-leftBleed;
    piece.clipWidth=piece.width+leftBleed+Math.max(0,rightBleed);
    piece.imageLeft=leftBleed-piece.sourceX;
  }
  return {width:w,height:h,drawHeight:SOURCE.stripHeight*scale,top:h-SOURCE.stripHeight*scale,
    imageWidth:SOURCE.width*scale,imageHeight:SOURCE.height*scale,sourceY:SOURCE.top*scale,scale,pieces};
}
