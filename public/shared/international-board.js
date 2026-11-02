// The compact white broadcast board, proportioned from the supplied 1920 x 1080 match clip.
// Flag panels and score tiles are vectors so the preview and FFmpeg use the same shapes.
import { cleanCountries, flagOutline, flagShapes } from './flags.js';

/**
 * How a point appears, measured frame by frame on the reference clip (30 fps), in seconds after the
 * rally ends: the serve marker leaves its row at once and grows in on the other row at `serveIn`
 * (over `serveGrow`); the old number speeds up out of the right of its tile (`out`), the tile stays
 * empty a moment, then the new number slides in from the left and settles (`inStart` + `in`).
 * `outBy` and `inFrom` are distances in tile widths.
 */
export const SCORE_MOTION = { out: 0.2, outBy: 0.75, inStart: 0.18, in: 0.2, inFrom: 0.47, serveIn: 0.067, serveGrow: 0.1 };
/** The whole change, start to settled. */
export const SCORE_MOTION_SECONDS = SCORE_MOTION.inStart + SCORE_MOTION.in;

export function internationalBoard({ width, height, names, state, style: s, flags, heading, banner, fontWidth }) {
  const items = [];
  const rect = (x,y,w,h,colour,opacity=1,layer=1) => items.push({type:'rect',x:Math.round(x),y:Math.round(y),w:Math.round(w),h:Math.round(h),colour,opacity,layer});
  const poly = (points,colour,opacity=1,layer=1) => items.push({type:'poly',points:points.map(p=>p.map(Math.round)),colour,opacity,layer});
  const countries = s.nationalFlags ? cleanCountries(s.countries) : ['', ''];
  const withFlags = countries.some(Boolean);
  const finished = s.showGames ? state.games : null;
  const mx = Math.round(width / 24);
  const my = Math.round(height * 0.075);
  const available = width - mx * 2;
  const maxWidth = width < height ? available : Math.min(available, width * 0.46);
  const columns = finished ? finished.length : 1;
  const fs = Math.max(6, Math.min(height / 38.5 * s.scale / 80, maxWidth / (6.6 + (withFlags ? 1.82 : 0) + columns * 1.55)));
  const rowH = Math.round(fs * 1.5);
  const pad = Math.max(2, Math.round(fs * 0.24));
  const frame = Math.max(1, Math.round(fs * 0.1));
  const cellW = Math.round(fs * 1.55);
  const gameW = cellW;
  const flagW = withFlags ? Math.round(fs * 1.82) : 0;
  const shuttleW = Math.round(fs * 0.82);
  const stretch = 78;
  const charWidth = fontWidth * stretch / 100;
  // Bold capitals run wider than FONTS' average: 0.53-0.59 of the size for Bahnschrift in Chrome (SAINDHAVI HEMANTH 0.583
  // against 0.56), so names and pills are fitted with room to spare and never run into the serve shuttle.
  const fitWidth = fontWidth * 1.08;
  const nameW = Math.max(fs * 5.7, Math.max(...names.map(n=>n.length), 1) * fs * fitWidth * stretch / 100);
  const otherW = frame * 2 + pad * 3 + flagW + shuttleW + cellW + columns * gameW;
  const boxW = Math.round(Math.min(maxWidth, nameW + otherW));
  const room = Math.max(fs * 2, boxW - otherW);
  const headH = heading ? Math.round(fs * 1.1) : 0;
  const boxH = rowH * 2 + frame * 2 + headH;
  const right = s.corner[1] === 'r';
  const bottom = s.corner[0] === 'b';
  const x0 = right ? width - mx - boxW : mx;
  const y0 = bottom ? height - my - boxH : my;
  const xPoints = x0 + boxW - frame - cellW;
  const xGames = xPoints - columns * gameW;
  const xName = x0 + frame + pad + flagW + (withFlags ? pad : 0);
  const opacity = s.opacity / 100;
  const text = (x,y,t,size,colour,extra={}) => items.push({type:'text',x:Math.round(x),y:Math.round(y),text:String(t),size:Math.round(size),colour,opacity:1,bold:true,anchor:'start',shadow:false,stretch,layer:3,...extra});
  const outline = (x,y,w,h) => [[x,y+fs*0.48],[x+fs*0.025,y+fs*0.29],[x+fs*0.15,y+fs*0.12],[x+fs*0.31,y+fs*0.025],[x+fs*0.48,y],[x+w,y],[x+w,y+h],[x,y+h]];
  poly(outline(x0+2,y0+3,boxW,boxH),'#000000',0.25*opacity,0);
  poly(outline(x0,y0,boxW,boxH),'#c5b9b3',opacity,0);
  poly(outline(x0+frame,y0+frame,boxW-frame*2,boxH-frame*2),s.box,opacity,0);
  if(heading) text(x0+pad,y0+headH/2+frame,heading,fs*0.58,s.text,{stretch:Math.min(stretch,(boxW-pad*2)/(Math.max(1,heading.length)*fs*0.58*fontWidth)*100),opacity:0.8});
  [0,1].forEach(row=>{
    const y = y0 + frame + headH + row * rowH;
    const mid = y + rowH / 2;
    if(row) rect(x0+frame,y-1,boxW-frame*2,1,'#a89a92',0.7);
    rect(x0+frame,y,boxW-frame*2-cellW,rowH/2,'#ffffff',0.12);
    const cell = {x:xPoints,y,w:cellW,h:rowH-1};
    rect(cell.x,cell.y,cell.w,cell.h,s.accent);
    rect(cell.x,cell.y,cell.w,cell.h/2,'#ffffff',0.16);
    rect(cell.x,cell.y+cell.h/2,cell.w,cell.h/2,'#000000',0.07);
    rect(cell.x,cell.y+cell.h/2,cell.w,1,'#000000',0.1);
    if(countries[row]) {
      const fx=x0+frame+pad*0.35, fy=y+pad*0.45, fh=rowH-pad*0.9;
      poly(flagOutline().map(([px,py])=>[fx+px*flagW,fy+py*fh]),'#b6b2ae');
      for(const shape of flagShapes(countries[row],fx+1,fy+1,flagW-2,fh-2)) items.push({...shape,layer:2});
    }
    text(xName,mid,names[row],fs*1.2,s.text,{stretch:Math.min(stretch/1.2,room/(Math.max(1,names[row].length)*fs*1.2*fitWidth)*100)});
    if(state.server===(row?'b':'a')) {
      const cx=xGames-pad-shuttleW/2, d=shuttleW;
      // Cork down-left, the broad skirt up-right, like the reference's serving marker.
      // serve/centre: the video and preview grow it in about its middle when the serve changes sides.
      for (const points of [[[cx-d*0.18,mid+d*0.02],[cx+d*0.06,mid-d*0.43],[cx+d*0.49,mid-d*0.05],[cx+d*0.1,mid+d*0.22]],
        [[cx-d*0.31,mid+d*0.1],[cx-d*0.1,mid+d*0.24],[cx-d*0.21,mid+d*0.41],[cx-d*0.4,mid+d*0.31]]]) {
        items.push({type:'poly',points:points.map(p=>p.map(Math.round)),colour:s.accent,opacity:1,layer:1,serve:true,centre:[Math.round(cx),Math.round(mid)]});
      }
    }
    if(finished) finished.forEach((g,i)=>{
      const gx=xGames+i*gameW;
      // Earlier games have a pale tile, the same size and lettering as the current brown tile.
      rect(gx,y,gameW,rowH-1,'#e9e3dd');
      rect(gx,y,gameW,(rowH-1)/2,'#ffffff',0.18);
      rect(gx,y,1,rowH,'#b5aaa2',0.45);
      text(gx+gameW/2,mid,g[row],fs*1.4,s.text,{anchor:'middle',stretch:65,key:`game${i}-${row}`,flip:false});
    });
    else text(xGames+gameW/2,mid,state.won[row],fs*1.15,s.text,{anchor:'middle',stretch:65,key:`won${row}`,flip:true});
    text(cell.x+cell.w/2,mid,state.points[row],fs*1.4,s.pointsText,{anchor:'middle',stretch:65,key:`points${row}`,flip:true,cell});
    if(s.flags && flags[row]) {
      const size=fs*0.52, w=flags[row].length*size*fitWidth*stretch/100+pad*2, h=fs*0.9;
      let x=right?x0-w-pad:x0+boxW+pad, yy=mid-h/2;
      if(x<mx || x+w>width-mx) {x=right?x0:x0+boxW-w;yy=bottom?y0-h-pad:y0+boxH+pad;}
      rect(x,yy,w,h,s.accent);
      text(x+w/2,yy+h/2,flags[row],size,s.pointsText,{anchor:'middle'});
    }
  });
  if(s.banners && banner) {
    const size=fs*0.62, h=Math.round(size*1.9);
    const w=Math.min(available,Math.max(boxW,banner.length*size*charWidth+pad*2));
    const x=right?x0+boxW-w:x0, y=bottom?y0-h-pad:y0+boxH+pad;
    rect(x,y,w,h,s.accent);
    text(x+w/2,y+h/2,banner,size,s.pointsText,{anchor:'middle',stretch:Math.min(stretch,(w-pad*2)/(Math.max(1,banner.length)*size*fontWidth)*100)});
  }
  return {items,box:{x:x0,y:y0,w:boxW,h:boxH},fontSize:Math.round(fs)};
}
