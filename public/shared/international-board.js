// The compact white broadcast board, proportioned from the supplied 1920 x 1080 match clip.
// Flag panels and score tiles are vectors so the preview and FFmpeg use the same shapes.
import { cleanCountries, flagOutline, flagShapes } from './flags.js';

/**
 * How a point appears, in seconds after the rally ends, measured pixel by pixel on the broadcast
 * (scoreboard.mp4, the board zoomed ~5.4x; 25 fps footage, so 40 ms steps). Both numbers move at a
 * steady speed, without easing: the old one slides right by `outBy` tile widths over `out`, stays
 * there half out of its tile for `outHold`, then goes; the new one appears `inFrom` tile widths to the
 * left at `inStart` and slides in over `in`. Numbers are cut off at the tile's left edge and `clipRight`
 * of its width on the right. The serve marker leaves its row at once and grows in on the other from
 * `serveIn`, its size every `serveStep` going through `serveSteps`.
 */
export const SCORE_MOTION = { out: 0.2, outBy: 0.5, outHold: 0.04, inStart: 0.2, in: 0.2, inFrom: 0.5, clipRight: 0.918, serveIn: 0.04, serveStep: 0.04, serveSteps: [0.3, 0.64, 0.89, 1] };
/** The whole change, start to settled. */
export const SCORE_MOTION_SECONDS = SCORE_MOTION.inStart + SCORE_MOTION.in;

// The serve marker traced from the broadcast, in row heights: a shuttle tilted 52.8° up to the right,
// a cork with a round end (0.164 wide, 0.122 long), a gap of 0.073, then a straight-sided skirt 0.291
// long, 0.22 wide at the cork and 0.36 at its open end, darker for its first fifth. Its middle sits
// 0.45 rows left of the score tiles and 0.02 rows below the row's middle.
const SHUTTLE = { angle: 52.8, corkR: 0.082, corkLen: 0.122, gap: 0.073, skirtLen: 0.291, skirtFrom: 0.11, skirtTo: 0.18, band: 0.2, left: 0.45, down: 0.02 };
const SHUTTLE_LONG = SHUTTLE.corkLen + SHUTTLE.gap + SHUTTLE.skirtLen;
/** Room the marker takes left of the score tiles, in row heights (its far end plus a little space before the name). */
const SERVE_SPACE = 0.76;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => `#${rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
const fine = (v) => Math.round(v * 100) / 100;

/**
 * The serve marker as coloured polygons around its middle (cx, cy), for a row `R` pixels high, in the
 * board's `accent`: the skirt the colour of the score tile's upper half, its base a little darker, a
 * dark brown cork (as measured: skirt #a46852, base #84533d, cork #5c4039 on a #965038 tile).
 */
export function serveShuttle(cx, cy, R, accent) {
  const a = (-SHUTTLE.angle * Math.PI) / 180; // the picture's y runs down
  const [ux, uy] = [Math.cos(a), Math.sin(a)]; // along the shuttle, cork to skirt
  const at = (u, v) => {
    const du = (u - SHUTTLE_LONG / 2) * R;
    const dv = v * R;
    return [fine(cx + du * ux - dv * uy), fine(cy + du * uy + dv * ux)];
  };
  const { corkR: r, corkLen, gap, skirtLen, skirtFrom, skirtTo, band } = SHUTTLE;
  const arc = Array.from({ length: 13 }, (_, i) => {
    const t = Math.PI / 2 + (i * Math.PI) / 12;
    return at(r + r * Math.cos(t), r * Math.sin(t));
  });
  const u0 = corkLen + gap;
  const half = (u) => skirtFrom + ((skirtTo - skirtFrom) * (u - u0)) / skirtLen;
  const ub = u0 + skirtLen * band;
  return [
    { points: [at(u0, -skirtFrom), at(u0 + skirtLen, -skirtTo), at(u0 + skirtLen, skirtTo), at(u0, skirtFrom)], colour: mix(accent, '#ffffff', 0.16) },
    { points: [at(u0, -skirtFrom), at(ub, -half(ub)), at(ub, half(ub)), at(u0, skirtFrom)], colour: mix(accent, '#000000', 0.12) },
    { points: [at(corkLen, r), ...arc, at(corkLen, -r)], colour: mix(accent, '#3a3a3a', 0.6) },
  ];
}

export function internationalBoard({ width, height, names, state, style: s, flags, heading, banner, font }) {
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
  const serveW = rowH * SERVE_SPACE;
  // Lettering from the broadcast: capitals 0.479 of the row high in names, figures 0.596. A condensed font
  // (D-DIN Condensed) is used as drawn, slightly thickened (FONTS embolden); a wider one is squeezed.
  const fontWidth = font.width;
  const stretch = font.condensed ? 100 : 78;
  const nameSize = (rowH * 0.479) / font.cap;
  const nameStretch = font.condensed ? 100 : 65;
  const digitSize = (rowH * 0.596) / font.cap;
  const digitStretch = font.condensed ? 100 : 65;
  const weight = (size) => (font.embolden ? { bold: false, embolden: fine(font.embolden * size) } : { bold: true });
  const charWidth = fontWidth * stretch / 100;
  // Capitals run a little wider than FONTS' average (SAINDHAVI HEMANTH 0.583 of the size in bold Bahnschrift
  // against 0.56), so names and pills are fitted with room to spare and never run into the serve marker.
  const fitWidth = fontWidth * 1.08;
  const nameW = Math.max(fs * 5.7, Math.max(...names.map(n=>n.length), 1) * nameSize * fitWidth * nameStretch / 100);
  const otherW = frame * 2 + pad * 2 + flagW + serveW + cellW + columns * gameW;
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
  const text = (x,y,t,size,colour,extra={}) => items.push({type:'text',x:Math.round(x),y:Math.round(y),text:String(t),size:Math.round(size),colour,opacity:1,...weight(size),anchor:'start',shadow:false,stretch,layer:3,...extra});
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
    text(xName,mid,names[row],nameSize,s.text,{stretch:Math.min(nameStretch,room/(Math.max(1,names[row].length)*nameSize*fitWidth)*100)});
    if(state.server===(row?'b':'a')) {
      // serve/centre: the video and preview grow it in about its middle when the serve changes sides.
      const centre=[fine(xGames-rowH*SHUTTLE.left),fine(mid+rowH*SHUTTLE.down)];
      for (const {points,colour} of serveShuttle(centre[0],centre[1],rowH,s.accent)) items.push({type:'poly',points,colour,opacity:1,layer:1,serve:true,centre});
    }
    if(finished) finished.forEach((g,i)=>{
      const gx=xGames+i*gameW;
      // Earlier games have a pale tile, the same size and lettering as the current brown tile.
      rect(gx,y,gameW,rowH-1,'#e9e3dd');
      rect(gx,y,gameW,(rowH-1)/2,'#ffffff',0.18);
      rect(gx,y,1,rowH,'#b5aaa2',0.45);
      text(gx+gameW/2,mid,g[row],digitSize,s.text,{anchor:'middle',stretch:digitStretch,key:`game${i}-${row}`,flip:false});
    });
    else text(xGames+gameW/2,mid,state.won[row],digitSize*0.82,s.text,{anchor:'middle',stretch:digitStretch,key:`won${row}`,flip:true});
    text(cell.x+cell.w/2,mid,state.points[row],digitSize,s.pointsText,{anchor:'middle',stretch:digitStretch,key:`points${row}`,flip:true,cell});
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
