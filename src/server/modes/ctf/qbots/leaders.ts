import { CTF_TEAMS } from '@airbattle/protocol';
import { MS_PER_SEC } from '@/constants';
import {
  CTF_BOT_CHAT_TEAM,
  CTF_PLAYER_SWITCHED,
  PLAYERS_REMOVED,
  TIMELINE_CLOCK_MINUTE,
  TIMELINE_GAME_MATCH_START,
} from '@/events';
import { System } from '@/server/system';
import { CTFLeadersStorage, PlayerId } from '@/types';

/**
 * This implementation is only applicable to Q-bots.
 */
export default class Leaders extends System {
  private leaders: CTFLeadersStorage;

  protected blueElectionsStartedAt = 0;

  protected redElectionsStartedAt = 0;

  constructor({ app }) {
    super({ app });

    this.leaders = this.storage.ctf.leaders;

    this.listeners = {
      [CTF_BOT_CHAT_TEAM]: this.onBotChat,
      [CTF_PLAYER_SWITCHED]: this.onPlayerSwitched,
      [PLAYERS_REMOVED]: this.onPlayerDisconnected,
      [TIMELINE_CLOCK_MINUTE]: this.onMinuteTick,
      [TIMELINE_GAME_MATCH_START]: this.onMatchStart,
    };
  }

  protected setLeaderByName(
    playerName: string,
    teamId: CTF_TEAMS = null,
    stopElections = true
  ): void {
    if (
      this.storage.playerNameList.has(playerName) === true &&
      this.storage.playerHistoryNameToIdList.has(playerName)
    ) {
      const { id } = this.storage.playerHistoryNameToIdList.get(playerName);
      let playerTeamId: CTF_TEAMS;

      if (teamId === null) {
        if (this.storage.playerList.has(id) === true) {
          playerTeamId = this.storage.playerList.get(id).team.current;
        }
      } else {
        playerTeamId = teamId;
      }

      if (playerTeamId === CTF_TEAMS.BLUE) {
        this.leaders.blueId = id;
        this.leaders.blueUpdatedAt = Date.now();

        if (stopElections === true) {
          this.leaders.isBlueElections = false;

          this.log.debug('Blue team leader elections fihished.');
        }

        this.log.debug('Detect blue team leader', { id, playerName });
      } else {
        this.leaders.redId = id;
        this.leaders.redUpdatedAt = Date.now();

        if (stopElections === true) {
          this.leaders.isRedElections = false;

          this.log.debug('Red team leader elections fihished.');
        }

        this.log.debug('Detect red team leader', { id, playerName });
      }
    } else {
      this.log.debug('Team leader not found', { playerName });
    }
  }

  /**
   * Parse the leader name from the "controlled by" message.
   *
   * @param msg
   * @param teamId
   */
  protected parseLeaderFromControlledBy(msg: string, teamId: CTF_TEAMS): void {
    const playerName = msg.substring(msg.indexOf('controlled by ') + 14, msg.length - 1);

    this.setLeaderByName(playerName, teamId, false);
  }

  protected clearPlayerLeaderStatus(playerId: PlayerId): void {
    if (this.leaders.blueId === playerId) {
      this.leaders.blueId = null;
    } else if (this.leaders.redId === playerId) {
      this.leaders.redId = null;
    }
  }

  /**
   * Parse the team chat message from the bot.
   *
   * @param botId
   * @param msg
   */
  onBotChat(botId: PlayerId, msg: string): void {
    if (!this.helpers.isPlayerConnected(botId)) {
      return;
    }

    const bot = this.storage.playerList.get(botId);

    if (msg === 'Type #yes in the next 30 seconds to become the new team leader.') {
      if (bot.team.current === CTF_TEAMS.BLUE) {
        this.leaders.isBlueElections = true;
        this.blueElectionsStartedAt = Date.now();

        this.log.debug('Blue team leader elections started.');
      } else {
        this.leaders.isRedElections = true;
        this.redElectionsStartedAt = Date.now();

        this.log.debug('Red team leader elections started.');
      }

      return;
    }

    const leaderChosenIndex = msg.indexOf(' has been chosen as the new team leader.');
    const isStillIndex = msg.indexOf(' is still the team leader.');

    // The blue team has 5 bots in auto mode controlled by playerName.
    if (
      msg.indexOf('The blue team has') === 0 &&
      msg.indexOf('controlled by', 20) !== -1 &&
      isStillIndex === -1 &&
      leaderChosenIndex === -1
    ) {
      this.log.debug(
        'Parse mgs type "The blue team has 5 bots in auto mode controlled by playerName."'
      );

      this.parseLeaderFromControlledBy(msg, CTF_TEAMS.BLUE);

      return;
    }

    // The red team has 7 bots in capture mode controlled by playerName.
    if (
      msg.indexOf('The red team has') === 0 &&
      msg.indexOf('controlled by', 20) !== -1 &&
      isStillIndex === -1 &&
      leaderChosenIndex === -1
    ) {
      this.log.debug(
        'Parse mgs type "The red team has 7 bots in capture mode controlled by playerName."'
      );

      this.parseLeaderFromControlledBy(msg, CTF_TEAMS.RED);

      return;
    }

    // playerName has been chosen as the new team leader.
    if (
      (leaderChosenIndex !== -1 && isStillIndex === -1) ||
      (leaderChosenIndex !== -1 && isStillIndex === 0)
    ) {
      this.log.debug('Parse mgs type "playerName has been chosen as the new team leader."');

      this.setLeaderByName(msg.substring(0, leaderChosenIndex === 0 ? 40 : leaderChosenIndex));

      return;
    }

    // playerName is still the team leader.
    if (isStillIndex !== -1) {
      this.log.debug('Parse mgs type "playerName is still the team leader."');

      this.setLeaderByName(msg.substring(0, isStillIndex === 0 ? 26 : isStillIndex));
    }
  }

  onPlayerDisconnected(playerId: PlayerId): void {
    this.clearPlayerLeaderStatus(playerId);
  }

  onPlayerSwitched(playerId: PlayerId): void {
    this.clearPlayerLeaderStatus(playerId);
  }

  onMatchStart(): void {
    this.leaders.blueId = null;
    this.leaders.redId = null;
    this.leaders.blueUpdatedAt = 0;
    this.leaders.redUpdatedAt = 0;
  }

  /**
   * Reset elections status in case something goes wrong.
   */
  onMinuteTick(): void {
    const expiredAt = Date.now() - 32 * MS_PER_SEC;

    if (this.leaders.isBlueElections === true && this.blueElectionsStartedAt < expiredAt) {
      this.leaders.isBlueElections = false;

      this.log.debug('Reset blue elections status.');
    }

    if (this.leaders.isRedElections === true && this.redElectionsStartedAt < expiredAt) {
      this.leaders.isRedElections = false;

      this.log.debug('Reset red elections status.');
    }
  }
}
