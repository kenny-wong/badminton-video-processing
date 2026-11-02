// Small vector flags shared by the browser and the rendered scoreboard. No emoji fonts or network requests.
// Coordinates are normalized before clipping to the broadcast board's shaped flag panel.
export const COUNTRIES = {
  AUS: 'Australia', AUT: 'Austria', BEL: 'Belgium', CAN: 'Canada', CHN: 'China',
  DEN: 'Denmark', ENG: 'England', FIN: 'Finland', FRA: 'France', GER: 'Germany',
  HKG: 'Hong Kong', ISL: 'Iceland', IND: 'India', INA: 'Indonesia', IRL: 'Ireland',
  ITA: 'Italy', JPN: 'Japan', MAS: 'Malaysia', NED: 'Netherlands', NZL: 'New Zealand',
  NOR: 'Norway', POL: 'Poland', SCO: 'Scotland', SGP: 'Singapore', KOR: 'South Korea',
  ESP: 'Spain', SWE: 'Sweden', SUI: 'Switzerland', TWN: 'Taiwan', THA: 'Thailand',
  GBR: 'United Kingdom', USA: 'United States', UKR: 'Ukraine', VIE: 'Vietnam',
};

export const cleanCountry = (value) => typeof value === 'string' && Object.hasOwn(COUNTRIES, value.toUpperCase()) ? value.toUpperCase() : '';
export const cleanCountries = (value) => [0, 1].map((k) => cleanCountry(Array.isArray(value) ? value[k] : null));

/** Clip a polygon to a convex outline; used for the sloping, rounded flag panels. */
export function clipPolygon(points, outline) {
  let out = points;
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < outline.length && out.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const input = out;
    out = [];
    let prev = input.at(-1);
    let dp = cross(a, b, prev);
    for (const next of input) {
      const dn = cross(a, b, next);
      if ((dn >= 0) !== (dp >= 0)) {
        const t = dp / (dp - dn);
        out.push([prev[0] + (next[0] - prev[0]) * t, prev[1] + (next[1] - prev[1]) * t]);
      }
      if (dn >= 0) out.push(next);
      prev = next;
      dp = dn;
    }
  }
  return out;
}

export function flagOutline() {
  return [[0, 0.28], [0.025, 0.16], [0.075, 0.07], [0.15, 0.015], [0.24, 0], [0.82, 0], [1, 1], [0, 1]];
}

/** One country's flag as coloured polygons, optionally within the shaped TV panel. */
export function flagShapes(country, x, y, width, height, shaped = true) {
  const code = cleanCountry(country);
  if (!code) return [];
  const shapes = [];
  const poly = (colour, points) => shapes.push({ colour, points });
  const rect = (colour, x, y, w, h) => poly(colour, [[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);
  const circle = (colour, cx, cy, rx, ry = rx * 1.5) => poly(colour, Array.from({length:40}, (_,i) => [cx + rx * Math.cos(i*Math.PI/20), cy + ry * Math.sin(i*Math.PI/20)]));
  const star = (colour, cx, cy, r, count = 5, angle = -Math.PI/2) => poly(colour, Array.from({length:count*2}, (_,i) => {
    const d = i%2 ? r*0.4 : r;
    return [cx+d*Math.cos(angle+i*Math.PI/count),cy+d*1.5*Math.sin(angle+i*Math.PI/count)];
  }));
  const stripes = (colours, vertical = false) => colours.forEach((c,i) => vertical ? rect(c,i/colours.length,0,1/colours.length,1) : rect(c,0,i/colours.length,1,1/colours.length));
  const nordic = (bg, cross, inner = null) => {
    rect(bg,0,0,1,1); rect(cross,0.3,0,0.14,1); rect(cross,0,0.4,1,0.2);
    if(inner) {rect(inner,0.335,0,0.07,1);rect(inner,0,0.45,1,0.1);}
  };
  const union = (ox = 0, oy = 0, w = 1, h = 1) => {
    const p=(c,pts)=>poly(c,pts.map(([x,y])=>[ox+x*w,oy+y*h]));
    rect('#012169',ox,oy,w,h);
    p('#ffffff',[[0,0],[0.12,0],[1,0.88],[1,1],[0.88,1],[0,0.12]]);
    p('#ffffff',[[1,0],[1,0.12],[0.12,1],[0,1],[0,0.88],[0.88,0]]);
    p('#c8102e',[[0,0],[0.055,0],[1,0.945],[1,1],[0.945,1],[0,0.055]]);
    p('#c8102e',[[1,0],[1,0.055],[0.055,1],[0,1],[0,0.945],[0.945,0]]);
    rect('#ffffff',ox+w*0.4,oy,w*0.2,h);rect('#ffffff',ox,oy+h*0.35,w,h*0.3);
    rect('#c8102e',ox+w*0.44,oy,w*0.12,h);rect('#c8102e',ox,oy+h*0.41,w,h*0.18);
  };
  switch(code) {
    case 'ENG': rect('#ffffff',0,0,1,1);rect('#ce1124',0.44,0,0.12,1);rect('#ce1124',0,0.41,1,0.18);break;
    case 'SCO': rect('#005eb8',0,0,1,1);poly('#ffffff',[[0,0],[0.15,0],[1,0.85],[1,1],[0.85,1],[0,0.15]]);poly('#ffffff',[[1,0],[1,0.15],[0.15,1],[0,1],[0,0.85],[0.85,0]]);break;
    case 'GBR': union();break;
    case 'DEN': nordic('#c8102e','#ffffff');break;
    case 'SWE': nordic('#006aa7','#fecc00');break;
    case 'FIN': nordic('#ffffff','#003580');break;
    case 'NOR': nordic('#ba0c2f','#ffffff','#00205b');break;
    case 'ISL': nordic('#02529c','#ffffff','#dc1e35');break;
    case 'FRA': stripes(['#002654','#ffffff','#ed2939'],true);break;
    case 'GER': stripes(['#000000','#dd0000','#ffce00']);break;
    case 'IRL': stripes(['#169b62','#ffffff','#ff883e'],true);break;
    case 'ITA': stripes(['#009246','#ffffff','#ce2b37'],true);break;
    case 'BEL': stripes(['#000000','#fdda24','#ef3340'],true);break;
    case 'NED': stripes(['#ae1c28','#ffffff','#21468b']);break;
    case 'AUT': stripes(['#ed2939','#ffffff','#ed2939']);break;
    case 'POL': stripes(['#ffffff','#dc143c']);break;
    case 'UKR': stripes(['#0057b7','#ffd700']);break;
    case 'INA': stripes(['#ff0000','#ffffff']);break;
    case 'THA': stripes(['#a51931','#ffffff','#2d2a4a','#2d2a4a','#ffffff','#a51931']);break;
    case 'ESP': stripes(['#aa151b','#f1bf00','#f1bf00','#aa151b']);break;
    case 'SUI': rect('#da291c',0,0,1,1);rect('#ffffff',0.42,0.2,0.16,0.6);rect('#ffffff',0.3,0.38,0.4,0.24);break;
    case 'JPN': rect('#ffffff',0,0,1,1);circle('#bc002d',0.5,0.5,0.2);break;
    case 'CHN': rect('#de2910',0,0,1,1);star('#ffde00',0.17,0.27,0.105);[[0.32,0.1],[0.39,0.22],[0.39,0.38],[0.32,0.51]].forEach(([x,y])=>star('#ffde00',x,y,0.035,5,Math.atan2((0.27-y)/1.5,0.17-x)));break;
    case 'VIE': rect('#da251d',0,0,1,1);star('#ffff00',0.5,0.5,0.25);break;
    case 'IND': stripes(['#ff9933','#ffffff','#138808']);circle('#000080',0.5,0.5,0.095);circle('#ffffff',0.5,0.5,0.077);circle('#000080',0.5,0.5,0.018);for(let i=0;i<24;i++){const a=i*Math.PI/12;poly('#000080',[[0.5,0.5],[0.5+0.08*Math.cos(a),0.5+0.12*Math.sin(a)],[0.5+0.08*Math.cos(a+0.06),0.5+0.12*Math.sin(a+0.06)]]);}break;
    case 'SGP': stripes(['#ef3340','#ffffff']);circle('#ffffff',0.19,0.25,0.12);circle('#ef3340',0.225,0.25,0.105);for(let i=0;i<5;i++)star('#ffffff',0.32+0.065*Math.sin(i*2*Math.PI/5),0.25-0.1*Math.cos(i*2*Math.PI/5),0.027);break;
    case 'MAS': stripes(Array.from({length:14},(_,i)=>i%2?'#ffffff':'#cc0000'));rect('#010066',0,0,0.5,0.57);circle('#ffcc00',0.2,0.28,0.115);circle('#010066',0.23,0.25,0.1);star('#ffcc00',0.35,0.27,0.095,14);break;
    case 'USA': stripes(Array.from({length:13},(_,i)=>i%2?'#ffffff':'#b22234'));rect('#3c3b6e',0,0,0.46,7/13);for(let row=0;row<9;row++)for(let col=0;col<(row%2?5:6);col++)star('#ffffff',0.037+col*0.076+(row%2?0.038:0),0.035+row*0.058,0.018);break;
    case 'CAN': stripes(['#ff0000','#ffffff','#ffffff','#ff0000'],true);poly('#ff0000',[[0.5,0.13],[0.54,0.3],[0.61,0.24],[0.59,0.43],[0.7,0.36],[0.68,0.47],[0.76,0.48],[0.62,0.64],[0.64,0.72],[0.52,0.7],[0.52,0.88],[0.48,0.88],[0.48,0.7],[0.36,0.72],[0.38,0.64],[0.24,0.48],[0.32,0.47],[0.3,0.36],[0.41,0.43],[0.39,0.24],[0.46,0.3]]);break;
    case 'AUS': case 'NZL': rect('#012169',0,0,1,1);union(0,0,0.5,0.5);if(code==='AUS')star('#ffffff',0.24,0.74,0.11,7);[[0.74,0.22],[0.61,0.49],[0.86,0.43],[0.74,0.8]].forEach(([x,y])=>{star('#ffffff',x,y,code==='AUS'?0.065:0.075,code==='AUS'?7:5);if(code==='NZL')star('#cc142b',x,y,0.052);});if(code==='AUS')star('#ffffff',0.8,0.6,0.035);break;
    case 'TWN': rect('#fe0000',0,0,1,1);rect('#000095',0,0,0.5,0.5);star('#ffffff',0.25,0.25,0.14,12);circle('#000095',0.25,0.25,0.085);circle('#ffffff',0.25,0.25,0.065);break;
    case 'HKG': rect('#de2910',0,0,1,1);for(let i=0;i<5;i++){const a=i*2*Math.PI/5;const petal=Array.from({length:20},(_,j)=>{const t=j*Math.PI/10;const u=0.1+0.09*Math.cos(t),v=0.055*Math.sin(t);return[0.5+u*Math.sin(a)+v*Math.cos(a),0.5+(u*Math.cos(a)-v*Math.sin(a))*1.5];});poly('#ffffff',petal);star('#de2910',0.5+0.12*Math.sin(a),0.5+0.18*Math.cos(a),0.018);}break;
    case 'KOR': rect('#ffffff',0,0,1,1);circle('#cd2e3a',0.5,0.5,0.2);poly('#0047a0',Array.from({length:21},(_,i)=>[0.5+0.2*Math.cos(i*Math.PI/20),0.5+0.3*Math.sin(i*Math.PI/20)]));circle('#cd2e3a',0.4,0.5,0.1);circle('#0047a0',0.6,0.5,0.1);[[0.19,0.21,0],[0.81,0.21,1],[0.19,0.79,2],[0.81,0.79,3]].forEach(([cx,cy,pattern])=>{for(let i=0;i<3;i++){const broken=pattern===1?i!==1:pattern===2?i===1:pattern===3;const x=cx-0.065+i*0.045; if(broken){rect('#000000',x,cy-0.09,0.025,0.07);rect('#000000',x,cy+0.02,0.025,0.07);}else rect('#000000',x,cy-0.09,0.025,0.18);}});break;
  }
  const outline = shaped ? flagOutline() : [[0,0],[1,0],[1,1],[0,1]];
  return shapes.map((shape) => ({ type: 'poly', colour: shape.colour, opacity: 1,
    points: clipPolygon(shape.points, outline).map(([px,py]) => [Math.round(x+px*width),Math.round(y+py*height)]),
  })).filter((shape)=>shape.points.length>=3);
}
