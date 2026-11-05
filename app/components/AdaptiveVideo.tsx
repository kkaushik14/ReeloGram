"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type VideoHTMLAttributes,
} from "react";
import type Hls from "hls.js";
import {
  VIDEO_PLAYBACK,
  imageKitVideoBase,
  progressiveVideoUrl,
  selectVideoCap,
  streamingVideoUrl,
  type PlaybackEnvironment,
  type VideoDimensions,
  type VideoRole,
} from "@/lib/video-playback";

type Connection = EventTarget & {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
};
type DeviceNavigator = Navigator & {
  connection?: Connection;
  deviceMemory?: number;
};
type Props = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src" | "onError"> & {
  src?: string;
  context?: VideoRole;
  active?: boolean;
  prepare?: boolean;
  playing?: boolean;
  sourceSize?: VideoDimensions;
  onPlaybackError?: (error: Error) => void;
  onPlaybackBlocked?: (blocked: boolean) => void;
  onPlaybackLoading?: (loading: boolean) => void;
};
let hlsModule: Promise<typeof import("hls.js")> | undefined;
const readyManifests = new Set<string>();
const unavailable = new Set<string>();

function environment(): PlaybackEnvironment {
  const device = navigator as DeviceNavigator;
  return {
    saveData: device.connection?.saveData,
    effectiveType: device.connection?.effectiveType,
    downlink: device.connection?.downlink,
    memory: device.deviceMemory,
    cores: device.hardwareConcurrency,
    dpr: devicePixelRatio,
  };
}
async function probe(url: string, manifest: boolean, signal: AbortSignal) {
  if (manifest && readyManifests.has(url)) return true;
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, VIDEO_PLAYBACK.probeTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: manifest ? {} : { Range: "bytes=0-0" },
      signal: request.signal,
    });
    const mime = response.headers.get("content-type") ?? "";
    if ([400, 401, 403, 404, 410].includes(response.status))
      unavailable.add(url);
    if (manifest) {
      if (response.status !== 200 || !/(mpegurl|text\/plain)/i.test(mime)) {
        await response.body?.cancel();
        return false;
      }
      const text = await response.text();
      if (!text.startsWith("#EXTM3U")) return false;
      readyManifests.add(url);
      return true;
    }
    const ready =
      (response.status === 200 || response.status === 206) &&
      mime.startsWith("video/");
    await response.body?.cancel();
    return ready;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
const delay = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
  });

/** One delivery implementation for Reels, dialogs, banners and auth previews. */
const AdaptiveVideo = forwardRef<HTMLVideoElement, Props>(
  function AdaptiveVideo(
    {
      src,
      context = "watch",
      active = true,
      prepare = false,
      playing,
      sourceSize,
      onPlaybackError,
      onPlaybackBlocked,
      onPlaybackLoading,
      autoPlay,
      onPlay,
      onPause,
      onLoadedData,
      ...props
    },
    forwardedRef,
  ) {
    const media = useRef<HTMLVideoElement>(null);
    useImperativeHandle(forwardedRef, () => media.current!);
    const [cap, setCap] = useState(720);
    const [loading, setLoading] = useState(false);
    const [visible, setVisible] = useState(true);
    useEffect(() => {
      const element = media.current;
      if (!element) return;
      const observer = new IntersectionObserver(
        (entries) => setVisible(entries[0]?.isIntersecting ?? true),
        { threshold: 0.05 },
      );
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    const capRef = useRef(cap);
    capRef.current = cap;
    const intent = useRef(playing ?? !!autoPlay);
    const controlled = useRef(playing !== undefined);
    controlled.current = playing !== undefined;
    if (playing !== undefined) intent.current = playing;
    const callbacks = useRef({
      onPlaybackError,
      onPlaybackBlocked,
      onPlaybackLoading,
    });
    callbacks.current = {
      onPlaybackError,
      onPlaybackBlocked,
      onPlaybackLoading,
    };
    useEffect(() => {
      callbacks.current.onPlaybackLoading?.(loading);
    }, [loading]);
    const stream = useRef<Hls | null>(null);
    const adaptiveCap = useRef<() => void>(() => {});
    const sourceError = useRef<() => void>(() => {});
    const resume = useRef<{ src?: string; time: number }>({ time: 0 });
    const transitioning = useRef(false);
    useEffect(() => {
      if (!src || active || !prepare) return;
      const device = environment();
      if (
        device.saveData ||
        ["slow-2g", "2g", "3g"].includes(device.effectiveType ?? "")
      )
        return;
      const controller = new AbortController();
      const endpoint = process.env.NEXT_PUBLIC_REELOGRAM_URL_ENDPOINT ?? "";
      if (imageKitVideoBase(src, endpoint)) {
        void probe(
          progressiveVideoUrl(src, endpoint, 360),
          false,
          controller.signal,
        );
        const manifest = streamingVideoUrl(src, endpoint, context, {
          width: sourceSize?.width,
          height: sourceSize?.height,
        });
        if (manifest) void probe(manifest, true, controller.signal);
      }
      return () => controller.abort();
    }, [src, active, prepare, context, sourceSize?.width, sourceSize?.height]);

    useEffect(() => {
      const element = media.current;
      if (!element) return;
      const update = () =>
        setCap(
          selectVideoCap(
            environment(),
            context,
            element.clientHeight || 720,
            { width: sourceSize?.width, height: sourceSize?.height },
            element.clientWidth,
          ),
        );
      update();
      const observer = new ResizeObserver(update);
      observer.observe(element);
      const connection = (navigator as DeviceNavigator).connection;
      connection?.addEventListener("change", update);
      window.addEventListener("resize", update);
      return () => {
        observer.disconnect();
        connection?.removeEventListener("change", update);
        window.removeEventListener("resize", update);
      };
    }, [context, sourceSize?.width, sourceSize?.height]);
    useEffect(() => {
      adaptiveCap.current();
    }, [cap]);

    useEffect(() => {
      const node = media.current;
      if (!node || !src || !active || !visible) {
        node?.pause();
        return;
      }
      const element: HTMLVideoElement = node;
      const lifecycle = new AbortController();
      const { signal } = lifecycle;
      let cancelled = false;
      let usingHls = false;
      let loadingProgressive = false;
      let lastHeight = 0;
      let failures = 0;
      let recoveries = 0;
      let pendingStream: string | null = null;
      let stalled = 0;
      let disposedHls = false;
      let startupTimer: ReturnType<typeof setTimeout> | undefined;
      capRef.current = selectVideoCap(
        environment(),
        context,
        element.clientHeight || 720,
        { width: sourceSize?.width, height: sourceSize?.height },
        element.clientWidth,
      );
      const endpoint = process.env.NEXT_PUBLIC_REELOGRAM_URL_ENDPOINT ?? "";
      const imagekit = !!imageKitVideoBase(src, endpoint);
      const initialTime = resume.current.src === src ? resume.current.time : 0;
      let savedTime = initialTime;
      setLoading(true);
      element.dataset.delivery = "loading";
      const play = () => {
        if (intent.current && !document.hidden)
          void element
            .play()
            .then(() => {
              if (!cancelled) callbacks.current.onPlaybackBlocked?.(false);
            })
            .catch((error) => {
              if (!cancelled && error?.name === "NotAllowedError")
                callbacks.current.onPlaybackBlocked?.(true);
            });
      };
      const restore = () => {
        if (savedTime > 0 && Number.isFinite(element.duration))
          element.currentTime = Math.min(
            savedTime,
            Math.max(0, element.duration - 0.1),
          );
        savedTime = 0;
      };
      const ready = () => {
        if (cancelled) return;
        clearTimeout(startupTimer);
        transitioning.current = false;
        setLoading(false);
        play();
      };
      const loaded = () => {
        restore();
      };
      const fail = () => {
        if (cancelled) return;
        setLoading(false);
        callbacks.current.onPlaybackError?.(
          new Error("Video playback is unavailable"),
        );
      };
      const destroyHls = () => {
        // Internal media handoffs must preserve the user's play/pause intent.
        transitioning.current = true;
        stream.current?.destroy();
        stream.current = null;
        usingHls = false;
      };
      const attachProgressive = (url: string, height: number) => {
        if (cancelled) return;
        savedTime = element.currentTime || initialTime;
        transitioning.current = true;
        destroyHls();
        lastHeight = height;
        element.dataset.delivery = "progressive";
        element.dataset.quality = String(height);
        element.src = url;
        element.load();
        play();
      };
      async function progressive(maximum = capRef.current) {
        if (loadingProgressive || cancelled) return;
        loadingProgressive = true;
        setLoading(true);
        if (!imagekit) {
          attachProgressive(src!, maximum);
          loadingProgressive = false;
          return;
        }
        const deadline = Date.now() + VIDEO_PLAYBACK.prepareTimeoutMs;
        while (!signal.aborted && Date.now() < deadline) {
          const target = Math.min(maximum, capRef.current);
          const fallback = Math.min(target, 360);
          const candidates = [...new Set([target, fallback])];
          const checks = await Promise.all(
            candidates.map((height) =>
              probe(progressiveVideoUrl(src!, endpoint, height), false, signal),
            ),
          );
          if (
            candidates.every((height) =>
              unavailable.has(progressiveVideoUrl(src!, endpoint, height)),
            )
          ) {
            loadingProgressive = false;
            fail();
            return;
          }
          const found = checks.findIndex(Boolean);
          if (found >= 0) {
            attachProgressive(
              progressiveVideoUrl(src!, endpoint, candidates[found]),
              candidates[found],
            );
            loadingProgressive = false;
            return;
          }
          await delay(VIDEO_PLAYBACK.retryIntervalMs, signal);
        }
        loadingProgressive = false;
        if (!cancelled) fail();
      }
      const native = !!element.canPlayType("application/vnd.apple.mpegurl");
      let manifest = streamingVideoUrl(
        src,
        endpoint,
        context,
        sourceSize,
        native ? capRef.current : undefined,
      );
      async function attachStream(url: string) {
        if (cancelled || (usingHls && !native)) return;
        clearTimeout(startupTimer);
        startupTimer = setTimeout(() => {
          if (
            !cancelled &&
            usingHls &&
            intent.current &&
            element.readyState < 2
          ) {
            destroyHls();
            void progressive();
          }
        }, VIDEO_PLAYBACK.streamStartupMs);
        if (native) {
          usingHls = true;
          transitioning.current = true;
          savedTime = element.currentTime || initialTime;
          element.dataset.delivery = "native-hls";
          element.src = url;
          element.load();
          play();
          return;
        }
        try {
          const { default: HlsPlayer } = await (hlsModule ??= import("hls.js"));
          if (cancelled) return;
          if (!HlsPlayer.isSupported()) {
            await progressive();
            return;
          }
          savedTime = element.currentTime || initialTime;
          transitioning.current = true;
          usingHls = true;
          const hls = new HlsPlayer({
            enableWorker: true,
            startLevel: -1,
            startPosition: savedTime,
            abrEwmaDefaultEstimate: capRef.current <= 360 ? 300000 : 1500000,
            maxBufferLength:
              capRef.current <= 360
                ? VIDEO_PLAYBACK.saverBufferSeconds
                : VIDEO_PLAYBACK.maxBufferSeconds,
            maxMaxBufferLength: 30,
            backBufferLength: 5,
            maxBufferSize: 20 * 1024 * 1024,
          });
          stream.current = hls;
          const update = () => {
            const levels = hls.levels;
            let index = 0;
            levels.forEach((level, position) => {
              if (level.height <= capRef.current) index = position;
            });
            hls.autoLevelCapping = index;
            element.dataset.qualityCap = String(capRef.current);
          };
          adaptiveCap.current = update;
          hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
            update();
            element.dataset.delivery = "hls";
            play();
          });
          hls.on(HlsPlayer.Events.LEVEL_SWITCHED, (_event, data) => {
            element.dataset.quality = String(
              hls.levels[data.level]?.height ?? capRef.current,
            );
          });
          hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
            if (!data.fatal || cancelled) return;
            if (
              data.type === HlsPlayer.ErrorTypes.MEDIA_ERROR &&
              recoveries++ < 1
            ) {
              hls.recoverMediaError();
              return;
            }
            destroyHls();
            void progressive();
          });
          hls.attachMedia(element);
          hls.loadSource(url);
        } catch {
          usingHls = false;
          await progressive();
        }
      }
      const onError = () => {
        if (cancelled) return;
        if (usingHls) {
          if (native) {
            destroyHls();
            void progressive();
          }
          return;
        }
        if (failures++ >= 2) {
          fail();
          return;
        }
        const lower =
          VIDEO_PLAYBACK.levels.filter((level) => level < lastHeight).at(-1) ??
          240;
        void progressive(lower);
      };
      sourceError.current = onError;
      const waiting = () => {
        if (usingHls || !lastHeight || stalled++ < 1 || loadingProgressive)
          return;
        const lower = VIDEO_PLAYBACK.levels
          .filter((level) => level < lastHeight)
          .at(-1);
        if (lower) void progressive(lower);
      };
      const pause = () => {
        if (!controlled.current && !transitioning.current && !document.hidden)
          intent.current = false;
        if (pendingStream && !cancelled) {
          const next = pendingStream;
          pendingStream = null;
          void attachStream(next);
        }
      };
      const manualPlay = () => {
        if (!controlled.current) intent.current = true;
      };
      let previousTime = 0;
      const time = () => {
        const looped = element.currentTime < previousTime;
        previousTime = element.currentTime;
        if (looped && pendingStream) {
          const next = pendingStream;
          pendingStream = null;
          void attachStream(next);
        }
      };
      let beforeHidden = false;
      const visibility = () => {
        if (document.hidden) {
          beforeHidden = !element.paused;
          element.pause();
        } else if (beforeHidden && intent.current) play();
      };
      element.addEventListener("loadedmetadata", loaded);
      element.addEventListener("canplay", ready);
      element.addEventListener("waiting", waiting);
      element.addEventListener("pause", pause);
      element.addEventListener("play", manualPlay);
      element.addEventListener("timeupdate", time);
      document.addEventListener("visibilitychange", visibility);
      const background = setInterval(() => {
        const target = manifest;
        if (!target || usingHls || cancelled || document.hidden) return;
        void probe(target, true, signal).then((found) => {
          if (!found || cancelled || usingHls || target !== manifest) return;
          if (element.paused || element.currentTime < 1)
            void attachStream(target);
          else pendingStream = target;
        });
      }, VIDEO_PLAYBACK.manifestRetryMs);
      void (async () => {
        const target = manifest;
        if (
          target &&
          (await probe(target, true, signal)) &&
          target === manifest
        )
          await attachStream(target);
        else await progressive();
      })();
      adaptiveCap.current = () => {
        if (native) {
          const next = streamingVideoUrl(
            src!,
            endpoint,
            context,
            sourceSize,
            capRef.current,
          );
          if (next !== manifest) {
            manifest = next;
            pendingStream = null;
            if (!next && usingHls) {
              destroyHls();
              void progressive();
            } else if (next) {
              const target = next;
              void probe(target, true, signal).then((found) => {
                if (found && !cancelled && target === manifest)
                  pendingStream = target;
              });
            }
          }
        }
        if (stream.current) {
          const levels = stream.current.levels;
          let index = 0;
          levels.forEach((level, position) => {
            if (level.height <= capRef.current) index = position;
          });
          stream.current.autoLevelCapping = index;
        } else if (lastHeight > capRef.current && !loadingProgressive)
          void progressive(capRef.current);
      };
      return () => {
        cancelled = true;
        lifecycle.abort();
        clearInterval(background);
        clearTimeout(startupTimer);
        sourceError.current = () => {};
        adaptiveCap.current = () => {};
        resume.current = { src, time: element.currentTime };
        transitioning.current = true;
        disposedHls = !!stream.current;
        destroyHls();
        element.pause();
        element.removeEventListener("loadedmetadata", loaded);
        element.removeEventListener("canplay", ready);
        element.removeEventListener("waiting", waiting);
        element.removeEventListener("pause", pause);
        element.removeEventListener("play", manualPlay);
        element.removeEventListener("timeupdate", time);
        document.removeEventListener("visibilitychange", visibility);
        element.removeAttribute("src");
        if (!disposedHls) element.load();
      };
      // A quality cap updates the current stream without recreating its media source.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, active, context, visible]);
    useEffect(() => {
      const element = media.current;
      if (!element) return;
      if (playing !== undefined) intent.current = playing;
      if (!active || playing === false) element.pause();
      else if (playing === true && element.readyState >= 2 && !document.hidden)
        void element.play().catch((error) => {
          if (error?.name === "NotAllowedError")
            callbacks.current.onPlaybackBlocked?.(true);
        });
    }, [playing, active]);
    return (
      <video
        {...props}
        controls={props.controls && !loading}
        ref={media}
        playsInline={props.playsInline ?? true}
        autoPlay={false}
        preload="none"
        aria-busy={loading}
        data-quality-cap={cap}
        onError={() => sourceError.current()}
        onPlay={(event) => {
          onPlaybackBlocked?.(false);
          onPlay?.(event);
        }}
        onPause={onPause}
        onLoadedData={onLoadedData}
      />
    );
  },
);
export default AdaptiveVideo;
