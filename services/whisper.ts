import { Asset } from 'expo-asset';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { initWhisper, TranscribeResult, WhisperContext } from 'whisper.rn';

const MODEL_NAME = 'ggml-base.bin';
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

export type ModelStatus = 
  | 'idle'
  | 'downloading'
  | 'initializing'
  | 'ready'
  | 'error';

export interface ModelProgress {
  status: ModelStatus;
  progress: number; // 0 to 100
  message: string;
}

export class WhisperService {
  private whisperContext: WhisperContext | null = null;
  private recording: Audio.Recording | null = null;
  private recordingInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessingChunk: boolean = false;
  private activeJob: { stop: () => Promise<void> } | null = null;

  /**
   * Resolve model path and initialize whisper.rn context
   */
  async initializeModel(
    onProgress?: (progress: ModelProgress) => void
  ): Promise<WhisperContext> {
    if (this.whisperContext) {
      return this.whisperContext;
    }

    try {
      onProgress?.({
        status: 'initializing',
        progress: 10,
        message: 'Checking model files...',
      });

      const modelUri = await this.ensureModelFile(onProgress);

      onProgress?.({
        status: 'initializing',
        progress: 80,
        message: 'Loading Whisper model into memory...',
      });

      const context = await initWhisper({
        filePath: modelUri,
        isBundleAsset: false,
        useGpu: true,
      });

      this.whisperContext = context;

      onProgress?.({
        status: 'ready',
        progress: 100,
        message: 'Bangla Whisper Model Ready',
      });

      return context;
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      const lower = errMsg.toLowerCase();
      let userFriendlyMessage = `Failed to load model: ${errMsg}`;

      if (
        lower.includes('install') ||
        lower.includes('null') ||
        lower.includes('nativernwhisper') ||
        lower.includes('is not an object') ||
        lower.includes('cannot read property')
      ) {
        userFriendlyMessage =
          'Native Whisper module missing (Expo Go detected). Please run custom dev client (npx expo run:android / run:ios).';
      }

      onProgress?.({
        status: 'error',
        progress: 0,
        message: userFriendlyMessage,
      });
      throw new Error(userxFriendlyMessage);
    }
  }

  /**
   * Ensure model exists locally or download it
   */
  private async ensureModelFile(
    onProgress?: (progress: ModelProgress) => void
  ): Promise<string> {
    const docDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
    const localModelPath = `${docDir}${MODEL_NAME}`;

    // 1. Check if model already exists in local document storage
    const fileInfo = await FileSystem.getInfoAsync(localModelPath);
    if (fileInfo.exists && (fileInfo.size || 0) > 10000000) {
      return localModelPath;
    }

    // 2. Try loading from bundled require asset if added to assets/models/
    try {
      /* eslint-disable */
      // @ts-ignore
      const bundledAsset = require('../assets/models/ggml-base.bin');
      /* eslint-enable */
      const asset = Asset.fromModule(bundledAsset);
      await asset.downloadAsync();
      if (asset.localUri) {
        return asset.localUri;
      }
    } catch {
      // Asset not bundled directly in JS require, proceed to download fallback
    }

    // 3. Download model file with progress tracking
    onProgress?.({
      status: 'downloading',
      progress: 0,
      message: 'Downloading Bangla STT Model (ggml-base.bin)...',
    });

    const downloadResumable = FileSystem.createDownloadResumable(
      MODEL_URL,
      localModelPath,
      {},
      (downloadProgress) => {
        const total = downloadProgress.totalBytesExpectedToWrite;
        const current = downloadProgress.totalBytesWritten;
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;

        onProgress?.({
          status: 'downloading',
          progress: pct,
          message: `Downloading model: ${pct}% (${(current / (1024 * 1024)).toFixed(1)} MB)`,
        });
      }
    );

    const result = await downloadResumable.downloadAsync();
    if (!result || !result.uri) {
      throw new Error('Failed to download model weights.');
    }

    return result.uri;
  }

  /**
   * Request microphone permissions
   */
  async requestPermissions(): Promise<boolean> {
    const { status } = await Audio.requestPermissionsAsync();
    return status === 'granted';
  }

  /**
   * Start live audio recording and transcribe loop
   */
  async startRecording(
    onInterimSegment: (text: string) => void,
    onFinalSegment: (text: string) => void,
    onError: (err: string) => void
  ): Promise<void> {
    if (!this.whisperContext) {
      throw new Error('Whisper model is not initialized.');
    }

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      onError('Microphone permission not granted.');
      return;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      this.recording = recording;

      // Periodically process chunk transcription every 2.5 seconds
      this.recordingInterval = setInterval(async () => {
        if (!this.recording || this.isProcessingChunk || !this.whisperContext) {
          return;
        }

        try {
          this.isProcessingChunk = true;
          const uri = this.recording.getURI();
          if (uri) {
            const options = {
              language: 'bn',
              maxThreads: 4,
            };

            const job = this.whisperContext.transcribe(uri, options);
            this.activeJob = job;
            const res: TranscribeResult = await job.promise;
            this.activeJob = null;

            if (res && res.result) {
              const text = res.result.trim();
              if (text) {
                onInterimSegment(text);
              }
            }
          }
        } catch {
          // Ignore interim chunk cancellation or transient processing errors
        } finally {
          this.isProcessingChunk = false;
        }
      }, 2500);
    } catch (err: any) {
      onError(`Failed to start recording: ${err?.message || err}`);
    }
  }

  /**
   * Stop recording and finalize text segment
   */
  async stopRecording(): Promise<string | null> {
    if (this.recordingInterval) {
      clearInterval(this.recordingInterval);
      this.recordingInterval = null;
    }

    if (this.activeJob) {
      try {
        await this.activeJob.stop();
      } catch {}
      this.activeJob = null;
    }

    let finalUri: string | null = null;
    if (this.recording) {
      try {
        finalUri = this.recording.getURI();
        await this.recording.stopAndUnloadAsync();
      } catch {}
      this.recording = null;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
    });

    if (finalUri && this.whisperContext) {
      try {
        const job = this.whisperContext.transcribe(finalUri, {
          language: 'bn',
          maxThreads: 4,
        });
        const res = await job.promise;
        return res?.result?.trim() || null;
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Release context resources
   */
  async release(): Promise<void> {
    await this.stopRecording();
    if (this.whisperContext) {
      await this.whisperContext.release();
      this.whisperContext = null;
    }
  }
}

export const whisperService = new WhisperService();
