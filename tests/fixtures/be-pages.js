// The shape of one day's match list on Badminton England's tournament pages, cut down, with made-up players.
const player = (id, name) => `<div class="match__row-title-value"><span class="match__row-title-value-content">
      <a href="/sport/player.aspx?id=x&amp;player=${id}" data-player-id="${id}" data-club-id="" class="nav-link"><span class="nav-link__value">${name}</span>
</a></span></div>`;
const match = ({ draw, round, aside, court, a, b, won, games }) => `<li class="match-group__item">
<div class="match match--list">
    <div class="match__header">
          <ul class="match__header-title">
              <li class="match__header-title-item">
      <a href="/sport/draw.aspx" class="nav-link"><span class="nav-link__value">${draw}</span></a>
              </li>
              <li class="match__header-title-item">
      <span title="${round}" class="nav-link"><span class="nav-link__value">${round}</span></span>
              </li>
          </ul>
              <div class="match__header-aside">
      <span class="nav-link btn--primary btn match__header-aside-block has-tooltip--wide" title="${aside}" data-toggle="tooltip">
<span class="nav-link__value"></span></span>
        </div>
    </div>
  <div class="match__body">
    <div class="match__row-wrapper">
<div class="match__row ${won === 1 ? 'has-won' : ''}"><div class="match__row-title">${a.map((n, i) => player(10 + i, n)).join('')}</div></div>
<div class="match__row ${won === 2 ? 'has-won' : ''}"><div class="match__row-title">${b.map((n, i) => player(20 + i, n)).join('')}</div></div>
    </div>
      <div class="match__result">
${games.map(([x, y]) => `<ul class="points"><li class="points__cell points__cell--won"> ${x}
          </li><li class="points__cell "> ${y}
          </li></ul>`).join('')}
      </div>
  </div>
    <div class="match__footer"><ul class="match__footer-list"><li class="match__footer-list-item">
      <span class="nav-link"><span class="nav-link__value">${court}</span></span>
    </li></ul></div>
</div>
</li>`;
export const PAGE = `<ol class="match-group"><li class="match-group__item"><div class="match-group__wrapper">
<h5 class="sticky is-sticky match-group__header"> 9:00 </h5><ol class="match-group">
${match({ draw: 'XD U15 - Group A', round: 'Round 1', aside: 'Duration: 12m | Example School - 3', court: 'Example School - 3', a: ['Amy Lee [1]', 'Ben Ng'], b: ['Cat Ho', 'Dan Wu [3/4]'], won: 1, games: [[21, 13]] })}
${match({ draw: 'OS U15 - Group B', round: 'Round 2', aside: 'Duration: 25m | Example School - 4', court: 'Example School - 4', a: ['Eli Ma'], b: ['Fin O&#39;Neil'], won: 2, games: [[19, 21], [21, 15], [12, 21]] })}
</ol></div></li><li class="match-group__item"><div class="match-group__wrapper">
<h5 class="sticky is-sticky match-group__header"> 14:45 </h5><ol class="match-group">
${match({ draw: 'XD U15', round: 'Final', aside: 'Example School - 1', court: 'Example School - 1', a: ['Amy Lee', 'Ben Ng'], b: ['Gus Yu', 'Hal Li'], won: 0, games: [] })}
</ol></div></li></ol>`;
