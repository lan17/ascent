import * as THREE from "three";

export type Laser = {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  hostile: boolean;
  active: boolean;
  damage: number;
};

export type RobotKind = "scout" | "grunt" | "turret" | "sniper";

export type RobotArchetype = {
  kind: RobotKind;
  maxHp: number;
  patrolSpeed: number;
  chaseSpeed: number;
  fireMin: number;
  fireMax: number;
  fireRange: number;
  losChaseRange: number;
  bfsBudget: number;
  laserSpeed: number;
  damage: number;
  scoreValue: number;
  tint: string;
  ringColor: string;
  haloColor: string;
  scale: number;
};

export const ROBOT_ARCHETYPES: Record<RobotKind, RobotArchetype> = {
  scout: {
    kind: "scout",
    maxHp: 25,
    patrolSpeed: 7,
    chaseSpeed: 14,
    fireMin: 1.6,
    fireMax: 2.4,
    fireRange: 14,
    losChaseRange: 10,
    bfsBudget: 10,
    laserSpeed: 60,
    damage: 8,
    scoreValue: 75,
    tint: "#ff7a44",
    ringColor: "#ffb066",
    haloColor: "#ff7a44",
    scale: 0.78,
  },
  grunt: {
    kind: "grunt",
    maxHp: 50,
    patrolSpeed: 4.5,
    chaseSpeed: 9,
    fireMin: 1.4,
    fireMax: 2.2,
    fireRange: 32,
    losChaseRange: 8,
    bfsBudget: 8,
    laserSpeed: 60,
    damage: 12,
    scoreValue: 100,
    tint: "#7a8392",
    ringColor: "#33ff88",
    haloColor: "#33ff88",
    scale: 1.0,
  },
  turret: {
    kind: "turret",
    maxHp: 110,
    patrolSpeed: 1.6,
    chaseSpeed: 2.8,
    fireMin: 0.55,
    fireMax: 0.9,
    fireRange: 24,
    losChaseRange: 6,
    bfsBudget: 4,
    laserSpeed: 55,
    damage: 10,
    scoreValue: 175,
    tint: "#b04a3a",
    ringColor: "#ff3a55",
    haloColor: "#ff3a55",
    scale: 1.25,
  },
  sniper: {
    kind: "sniper",
    maxHp: 40,
    patrolSpeed: 3.2,
    chaseSpeed: 6,
    fireMin: 2.6,
    fireMax: 3.6,
    fireRange: 60,
    losChaseRange: 18,
    bfsBudget: 6,
    laserSpeed: 110,
    damage: 22,
    scoreValue: 150,
    tint: "#a070ff",
    ringColor: "#c8a8ff",
    haloColor: "#a070ff",
    scale: 0.95,
  },
};

export type Robot = {
  id: number;
  kind: RobotKind;
  pos: THREE.Vector3;
  hp: number;
  fireCooldown: number;
  bobPhase: number;
  alive: boolean;
  mode: "patrol" | "chase";
  targetCell: [number, number, number] | null;
  lastCell: [number, number, number] | null;
  aiTimer: number;
  cellOffset: THREE.Vector3;
  strafeTimer: number;
  hitFlash: number;
  hasSeenPlayer: boolean;
  // Decays each frame after firing; drives recoil/muzzle-flash animations.
  muzzleFlash: number;
};

export type GameState = {
  status: "menu" | "playing" | "dead" | "won";
  health: number;
  shields: number;
  score: number;
  enemiesLeft: number;
  reactorAlive: boolean;
  message: string;
};

export const initialState: GameState = {
  status: "menu",
  health: 100,
  shields: 100,
  score: 0,
  enemiesLeft: 0,
  reactorAlive: true,
  message: "",
};
