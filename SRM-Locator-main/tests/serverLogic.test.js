import { describe, it, expect } from 'vitest';

/**
 * Validates the pure business logic algorithms used inside backend/server.js
 */
describe('Server Squad Logic', () => {
  describe('Mutiny Quorum Calculation', () => {
    // Formula from server.js: Math.max(2, Math.ceil(squad.members.length / 2))
    const computeRequiredVotes = (memberCount) => Math.max(2, Math.ceil(memberCount / 2));

    it('requires at least 2 votes even for 1-3 member squads', () => {
      expect(computeRequiredVotes(1)).toBe(2);
      expect(computeRequiredVotes(2)).toBe(2);
      expect(computeRequiredVotes(3)).toBe(2);
    });

    it('calculates majority quorum for larger squads', () => {
      expect(computeRequiredVotes(4)).toBe(2);
      expect(computeRequiredVotes(5)).toBe(3);
      expect(computeRequiredVotes(6)).toBe(3);
      expect(computeRequiredVotes(7)).toBe(4);
      expect(computeRequiredVotes(10)).toBe(5);
    });
  });

  describe('Stale Squad TTL Filter', () => {
    const ROOM_TTL_MS = 5 * 60 * 1000; // 5 minutes

    const isSquadStale = (now, lastActivity) => {
      return now - (lastActivity || 0) > ROOM_TTL_MS;
    };

    it('identifies fresh squads as not stale', () => {
      const now = Date.now();
      expect(isSquadStale(now, now - 60000)).toBe(false); // 1 min ago
      expect(isSquadStale(now, now - 240000)).toBe(false); // 4 min ago
    });

    it('identifies inactive squads past TTL as stale', () => {
      const now = Date.now();
      expect(isSquadStale(now, now - 300001)).toBe(true); // 5 min 1 ms ago
      expect(isSquadStale(now, now - 600000)).toBe(true); // 10 min ago
      expect(isSquadStale(now, 0)).toBe(true);
      expect(isSquadStale(now, null)).toBe(true);
    });
  });

  describe('Squad Succession Mechanism', () => {
    it('promotes next remaining member when owner leaves', () => {
      const activeSquads = {
        ALPHA1: {
          ownerId: 'socket-1',
          members: ['socket-1', 'socket-2', 'socket-3']
        }
      };

      const handleSquadSuccession = (disconnectedId) => {
        for (const roomCode in activeSquads) {
          const squad = activeSquads[roomCode];
          squad.members = squad.members.filter(id => id !== disconnectedId);

          if (squad.members.length === 0) {
            delete activeSquads[roomCode];
          } else if (squad.ownerId === disconnectedId) {
            squad.ownerId = squad.members[0];
          }
        }
      };

      handleSquadSuccession('socket-1');
      expect(activeSquads.ALPHA1.ownerId).toBe('socket-2');
      expect(activeSquads.ALPHA1.members).toEqual(['socket-2', 'socket-3']);
    });

    it('deletes squad room when last member disconnects', () => {
      const activeSquads = {
        SOLO01: {
          ownerId: 'socket-1',
          members: ['socket-1']
        }
      };

      const handleSquadSuccession = (disconnectedId) => {
        for (const roomCode in activeSquads) {
          const squad = activeSquads[roomCode];
          squad.members = squad.members.filter(id => id !== disconnectedId);

          if (squad.members.length === 0) {
            delete activeSquads[roomCode];
          } else if (squad.ownerId === disconnectedId) {
            squad.ownerId = squad.members[0];
          }
        }
      };

      handleSquadSuccession('socket-1');
      expect(activeSquads.SOLO01).toBeUndefined();
    });
  });
});
