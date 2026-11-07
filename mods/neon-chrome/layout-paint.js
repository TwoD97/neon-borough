// Paint-only projection: never retain a layout tree between renders. Resizes,
// active children and terminal assignments always come from the newest tree.
const targets = [
  ["root", [], "background", "background"],
  ["root", [], "terminal_opacity", 1],
  ["desktop", [], "background", "canvas"],
  ["sidebar", [], "background", "chrome"],
  ["main", [], "background", "canvas"],
  ["main", ["content", "pane"], "background", "background"],
];
export function findNode(node,id) {
  if(node?.id===id)return node;
  for(const child of node?.children || []){const found=findNode(child,id);if(found)return found;}
  return null;
}
function owner(tree,id,path){let value=findNode(tree,id);for(const key of path)value=value?.[key];return value;}
export function projectPaint(current,light,previous) {
  const next=JSON.parse(JSON.stringify(current));
  const originals=light ? [] : previous?.originals || [];
  let changed=false;
  targets.forEach(([id,path,key,value],index)=>{
    const node=owner(next,id,path);if(!node)return;
    if(light){
      originals[index]={present:Object.prototype.hasOwnProperty.call(node,key),value:node[key]};
      if(JSON.stringify(node[key])!==JSON.stringify(value)){node[key]=value;changed=true;}
    }else{
      const saved=originals[index];if(!saved)return;
      // Respect an explicit paint edit made while light mode was active.
      if(JSON.stringify(node[key])!==JSON.stringify(value))return;
      if(saved.present)node[key]=saved.value;else delete node[key];
      changed=true;
    }
  });
  return {next,changed,state:{light,originals:light?originals:[]}};
}
