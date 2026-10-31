export const ID = 'c7fa0c7e-1adb-412f-a229-190bd893db4f';

/** A made-up badminfo player id for player n. */
export const playerId = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// The shape of badminfo's tournament JSON, cut down, with made-up players.
export const SAMPLE = {
  beTournament: {
    id: ID,
    beId: 'ca88e186-d31b-4e88-b01a-b7f64d301760',
    name: 'Example Super Series',
    startDate: '2026-10-25T00:00:00',
    endDate: '2027-04-18T00:00:00',
    players: ['Amy', 'Bea', 'Cat', 'Dee', 'Eve', 'Fay', 'Gil', 'Hal'].map((playerEntryName, index) => ({ index, playerEntryName, id: playerId(index) })),
    events: [
      {
        name: 'WD Example',
        draws: [{
          type: 'Round Robin',
          name: 'WD Example',
          rubbers: [
            { team1PlayerIndexes: [0, 1], team2PlayerIndexes: [2, 3], winningTeam: 1, games: [{ team1Score: 21, team2Score: 15 }, { team1Score: 21, team2Score: 11 }] },
            { team1PlayerIndexes: [0, 1], team2PlayerIndexes: [4, 5], winningTeam: 1, games: [{ team1Score: 22, team2Score: 20 }, { team1Score: 17, team2Score: 21 }, { team1Score: 22, team2Score: 20 }] },
            // Listed the other way round from the first match.
            { team1PlayerIndexes: [5, 4], team2PlayerIndexes: [3, 2], winningTeam: 2, scoreText: 'Walkover', games: [] },
          ],
        }],
      },
      {
        name: 'OD Example',
        draws: [
          { type: 'Elimination', name: 'OD Example - Main', rubbers: [{ team1PlayerIndexes: [6], team2PlayerIndexes: [7], winningTeam: 1, games: [{ team1Score: 21, team2Score: 3 }] }] },
          { type: 'Round Robin', name: 'OD Ex - Group A', rubbers: [] },
        ],
      },
      { name: 'XD Example', draws: [] },
    ],
  },
};

// The shape of badminfo's player JSON, cut down, for a made-up player.
export const PLAYER_ID = '11111111-2222-4333-8444-555555555555';
export const PLAYER = {
  id: PLAYER_ID,
  name: 'Kim  Example',
  beNumber: 1234567,
  gradings: [
    { key: 'Mixed', value: 'H', firstSeenUtc: '2026-10-30T13:19:18Z' },
    { key: 'Single', value: 'H', firstSeenUtc: '2026-10-30T13:05:00Z' },
    { key: 'Mixed', value: 'I', firstSeenUtc: '2026-06-26T12:12:18Z' },
    { key: 'Single', value: 'I', firstSeenUtc: '2026-06-26T11:55:00Z' },
    { key: 'Double', value: 'I', firstSeenUtc: '2026-02-27T12:07:27Z' },
    { key: 'Double', value: 'J', firstSeenUtc: '2024-12-17T07:17:32Z' },
  ],
  ratings: { ratingsDate: '2026-10-30T00:00:00Z', singlesRating: 515, doublesRating: 463, mixedRating: 473 },
  upcomingTournaments: [
    { id: 'aaaa0001-0000-4000-8000-000000000001', name: 'Example U15 Silver', startDate: '2026-11-01T00:00:00', endDate: '2026-11-01T00:00:00' },
  ],
  competitionsWithRubbers: [
    // The upcoming tournament appears here too, with no matches yet.
    { tournament: { id: 'aaaa0001-0000-4000-8000-000000000001', name: 'Example U15 Silver', startDate: '2026-11-01T00:00:00', endDate: '2026-11-01T00:00:00' }, rubbers: [] },
    { tournament: { id: 'aaaa0002-0000-4000-8000-000000000002', name: 'Example U15 Bronze October', startDate: '2026-10-24T00:00:00', endDate: '2026-10-24T00:00:00' }, rubbers: [{}] },
    { tournament: null, league: { name: 'A league' }, rubbers: [{}] },
  ],
};
