const i18n = require('LanguageData');
i18n.init(window.language); // languageID should be equal to the one we input in New Language ID input field

const OnlineMap = require('./Map');

cc.Class({
  extends: OnlineMap,

  onDestroy() {
    console.warn("+++++++ Map onDestroy()");
  },

  onLoad() {
    const self = this;
    window.mapIns = self;
    self.showCriticalCoordinateLabels = false;

    const mapNode = self.node;
    const canvasNode = mapNode.parent;

    self.mainCameraNode = self.canvasNode.getChildByName("Main Camera");
    self.mainCamera = self.mainCameraNode.getComponent(cc.Camera);
    for (let child of self.mainCameraNode.children) {
      child.setScale(1 / self.mainCamera.zoomRatio);
    }
    self.widgetsAboveAllNode = self.mainCameraNode.getChildByName("WidgetsAboveAll");
    self.mainCameraNode.setPosition(cc.v2());

    /** Init required prefab ended. */

    self.inputDelayFrames = 8;
    self.inputScaleFrames = 2;
    self.inputFrameUpsyncDelayTolerance = 2;
    self.collisionMinStep = 8;

    self.renderCacheSize = 1024;
    self.serverFps = 60;
    self.rollbackEstimatedDt = 0.016667;
    self.rollbackEstimatedDtMillis = 16.667;
    self.rollbackEstimatedDtNanos = 16666666;
    self.tooFastDtIntervalMillis = 0.5 * self.rollbackEstimatedDtMillis;

    const tiledMapIns = self.node.getComponent(cc.TiledMap);

    const fullPathOfTmxFile = cc.js.formatStr("map/%s/map", "dungeon");
    cc.loader.loadRes(fullPathOfTmxFile, cc.TiledMapAsset, (err, tmxAsset) => {
      if (null != err) {
        console.error(err);
        return;
      }

      tiledMapIns.tmxAsset = null;
      mapNode.removeAllChildren();

      if (self.showCriticalCoordinateLabels) {
        const drawer = new cc.Node();
        drawer.setPosition(cc.v2(0, 0))
        safelyAddChild(self.node, drawer);
        setLocalZOrder(drawer, 999);
        const g = drawer.addComponent(cc.Graphics);
        g.lineWidth = 2;
        self.g = g;
      }

      tiledMapIns.tmxAsset = tmxAsset;
      const newMapSize = tiledMapIns.getMapSize();
      const newTileSize = tiledMapIns.getTileSize();
      self.node.setContentSize(newMapSize.width * newTileSize.width, newMapSize.height * newTileSize.height);
      self.node.setPosition(cc.v2(0, 0));

      self.spaceOffsetX = ((newMapSize.width * newTileSize.width) >> 1);
      self.spaceOffsetY = ((newMapSize.height * newTileSize.height) >> 1);

      self._resetCurrentMatch();
      let barrierIdCounter = 0;
      const boundaryObjs = tileCollisionManager.extractBoundaryObjects(self.node);
      for (let boundaryObj of boundaryObjs.barriers) {
        const gopkgsBoundaryAnchor = gopkgs.NewVec2DJs(boundaryObj.anchor.x, boundaryObj.anchor.y);
        const gopkgsBoundaryPts = Array.from(boundaryObj, p => {
          return gopkgs.NewVec2DJs(p.x, p.y);
        });
        const gopkgsBoundary = gopkgs.NewPolygon2DJs(gopkgsBoundaryAnchor, gopkgsBoundaryPts);
        const gopkgsBarrier = gopkgs.NewBarrierJs(gopkgsBoundary);

        const newBarrierCollider = gopkgs.GenerateConvexPolygonColliderJs(gopkgsBoundary, self.spaceOffsetX, self.spaceOffsetY, gopkgsBarrier, "Barrier");
        self.gopkgsCollisionSys.Add(newBarrierCollider);

        if (false && self.showCriticalCoordinateLabels) {
          for (let i = 0; i < boundaryObj.length; ++i) {
            const barrierVertLabelNode = new cc.Node();
            switch (i % 4) {
              case 0:
                barrierVertLabelNode.color = cc.Color.RED;
                break;
              case 1:
                barrierVertLabelNode.color = cc.Color.GRAY;
                break;
              case 2:
                barrierVertLabelNode.color = cc.Color.BLACK;
                break;
              default:
                barrierVertLabelNode.color = cc.Color.MAGENTA;
                break;
            }
            const wx = boundaryObj.anchor.x + boundaryObj[i].x,
              wy = boundaryObj.anchor.y + boundaryObj[i].y;
            barrierVertLabelNode.setPosition(cc.v2(wx, wy));
            const barrierVertLabel = barrierVertLabelNode.addComponent(cc.Label);
            barrierVertLabel.fontSize = 12;
            barrierVertLabel.lineHeight = barrierVertLabel.fontSize + 1;
            barrierVertLabel.string = `(${wx.toFixed(1)}, ${wy.toFixed(1)})`;
            safelyAddChild(self.node, barrierVertLabelNode);
            setLocalZOrder(barrierVertLabelNode, 5);

            barrierVertLabelNode.active = true;
          }

        }
        // console.log("Created barrier: ", newBarrierCollider);
        ++barrierIdCounter;
        const collisionBarrierIndex = (self.collisionBarrierIndexPrefix + barrierIdCounter);
        self.gopkgsCollisionSysMap[collisionBarrierIndex] = newBarrierCollider;
      }

      const p1Vpos = gopkgs.WorldToVirtualGridPos(boundaryObjs.playerStartingPositions[0].x, boundaryObjs.playerStartingPositions[0].y);
      const p2Vpos = gopkgs.WorldToVirtualGridPos(boundaryObjs.playerStartingPositions[1].x, boundaryObjs.playerStartingPositions[1].y);
      const speedV = gopkgs.WorldToVirtualGridPos(1.0, 0);
      const colliderRadiusV = gopkgs.WorldToVirtualGridPos(12.0, 0);

      const startRdf = window.pb.protos.RoomDownsyncFrame.create({
        id: window.MAGIC_ROOM_DOWNSYNC_FRAME_ID.BATTLE_START,
        playersArr: [
          window.pb.protos.PlayerDownsync.create({
            id: 10,
            joinIndex: 1,
            virtualGridX: p1Vpos[0],
            virtualGridY: p1Vpos[1],
            speed: speedV[0],
            colliderRadius: colliderRadiusV[0],
            characterState: window.ATK_CHARACTER_STATE.InAirIdle1NoJump[0],
            framesToRecover: 0,
            dirX: +2,
            dirY: 0,
            velX: 0,
            velY: 0,
            inAir: true,
          }),
          window.pb.protos.PlayerDownsync.create({
            id: 11,
            joinIndex: 2,
            virtualGridX: p2Vpos[0],
            virtualGridY: p2Vpos[1],
            speed: speedV[0],
            colliderRadius: colliderRadiusV[0],
            characterState: window.ATK_CHARACTER_STATE.InAirIdle1NoJump[0],
            framesToRecover: 0,
            dirX: -2,
            dirY: 0,
            velX: 0,
            velY: 0,
            inAir: true,
          }),
        ],
        speciesIdList: [1, 0],
      });

      self.selfPlayerInfo = {
        Id: 10,
        JoinIndex: 1,
      };
      self.onRoomDownsyncFrame(startRdf);

      self.battleState = ALL_BATTLE_STATES.IN_BATTLE;
    });

  },

  update(dt) {
    const self = this;
    if (ALL_BATTLE_STATES.IN_BATTLE == self.battleState) {
      const elapsedMillisSinceLastFrameIdTriggered = performance.now() - self.lastRenderFrameIdTriggeredAt;
      if (elapsedMillisSinceLastFrameIdTriggered < self.tooFastDtIntervalMillis) {
        // [WARNING] We should avoid a frontend ticking too fast to prevent cheating, as well as ticking too slow to cause a "resync avalanche" that impacts user experience!
        // console.debug("Avoiding too fast frame@renderFrameId=", self.renderFrameId, ": elapsedMillisSinceLastFrameIdTriggered=", elapsedMillisSinceLastFrameIdTriggered);
        return;
      }
      try {
        let st = performance.now();
        let prevSelfInput = null,
          currSelfInput = null;
        const noDelayInputFrameId = self._convertToInputFrameId(self.renderFrameId, 0); // It's important that "inputDelayFrames == 0" here 
        if (self.shouldGenerateInputFrameUpsync(self.renderFrameId)) {
          const prevAndCurrInputs = self.getOrPrefabInputFrameUpsync(noDelayInputFrameId);
          prevSelfInput = prevAndCurrInputs[0];
          currSelfInput = prevAndCurrInputs[1];
        }

        const [prevRdf, rdf] = self.rollbackAndChase(self.renderFrameId, self.renderFrameId + 1, self.gopkgsCollisionSys, self.gopkgsCollisionSysMap, false);
        self.applyRoomDownsyncFrameDynamics(rdf, prevRdf);
        self.showDebugBoundaries(rdf);
        ++self.renderFrameId;
        self.lastRenderFrameIdTriggeredAt = performance.now();
        let t3 = performance.now();
      } catch (err) {
        console.error("Error during Map.update", err);
      }
    }
  },

});
