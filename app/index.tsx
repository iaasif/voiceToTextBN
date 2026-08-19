import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { whisperService, ModelProgress, ModelStatus } from '../services/whisper';

export default function Index() {
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [modelProgress, setModelProgress] = useState<ModelProgress>({
    status: 'idle',
    progress: 0,
    message: 'Tap to initialize model',
  });
  const [isRecording, setIsRecording] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [completedText, setCompletedText] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const toastAnim = useRef(new Animated.Value(0)).current;

  // Initialize model on mount
  useEffect(() => {
    let isMounted = true;

    async function setupModel() {
      try {
        await whisperService.initializeModel((prog) => {
          if (isMounted) {
            setModelStatus(prog.status);
            setModelProgress(prog);
          }
        });
      } catch (err: any) {
        if (isMounted) {
          setModelStatus('error');
          setModelProgress({
            status: 'error',
            progress: 0,
            message: err?.message || 'Failed to initialize Whisper model',
          });
        }
      }
    }

    setupModel();

    return () => {
      isMounted = false;
      whisperService.release();
    };
  }, []);

  // Pulsing animation for mic recording state
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;

    if (isRecording) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.25,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      pulseAnim.setValue(1);
    }

    return () => {
      if (animation) {
        animation.stop();
      }
    };
  }, [isRecording, pulseAnim]);

  // Toast feedback helper
  const showToast = (message: string) => {
    setToastMessage(message);
    Animated.sequence([
      Animated.timing(toastAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.delay(2000),
      Animated.timing(toastAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => setToastMessage(null));
  };

  // Toggle mic recording
  const handleToggleRecording = async () => {
    if (modelStatus !== 'ready') {
      showToast('Whisper model is loading. Please wait...');
      return;
    }

    try {
      if (isRecording) {
        // Stop recording
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setIsRecording(false);
        const finalSegment = await whisperService.stopRecording();
        
        setLiveText('');
        if (finalSegment) {
          setCompletedText((prev) => (prev ? `${prev} ${finalSegment}` : finalSegment));
          showToast('Transcription segment saved');
        }
      } else {
        // Start recording
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setIsRecording(true);
        setLiveText('');
        
        await whisperService.startRecording(
          (interimText) => {
            setLiveText(interimText);
          },
          (finalText) => {
            if (finalText) {
              setCompletedText((prev) => (prev ? `${prev} ${finalText}` : finalText));
              setLiveText('');
            }
          },
          (error) => {
            setIsRecording(false);
            showToast(`Error: ${error}`);
          }
        );
      }
    } catch (err: any) {
      setIsRecording(false);
      showToast(`Recording failed: ${err?.message || err}`);
    }
  };

  // Clean button action
  const handleClean = () => {
    if (!completedText && !liveText) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'লেখা মুছে ফেলুন (Clean Text)',
      'আপনি কি সম্পূর্ণ টেক্সট মুছে ফেলতে চান?',
      [
        { text: 'বাতিল (Cancel)', style: 'cancel' },
        {
          text: 'মুছে ফেলুন (Clean)',
          style: 'destructive',
          onPress: () => {
            setCompletedText('');
            setLiveText('');
            showToast('টেক্সট মোছা হয়েছে (Cleared)');
          },
        },
      ]
    );
  };

  // Copy button action
  const handleCopy = async () => {
    const textToCopy = completedText || liveText;
    if (!textToCopy) {
      showToast('কপি করার মতো কোনো লেখা নেই (Nothing to copy)');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(textToCopy);
    showToast('ক্লিপবোর্ডে কপি করা হয়েছে (Copied to clipboard)!');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {/* Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle}>বাংলা ভয়েস টাইপিং</Text>
          <View style={styles.offlineBadge}>
            <Ionicons name="wifi-outline" size={12} color="#10B981" />
            <Text style={styles.offlineText}>OFFLINE</Text>
          </View>
        </View>

        {/* Model Status Indicator */}
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              modelStatus === 'ready' && styles.statusDotReady,
              modelStatus === 'downloading' && styles.statusDotBusy,
              modelStatus === 'initializing' && styles.statusDotBusy,
              modelStatus === 'error' && styles.statusDotError,
            ]}
          />
          <Text style={styles.statusMessage} numberOfLines={1}>
            {modelProgress.message}
          </Text>
        </View>

        {/* Download Progress Bar if active */}
        {(modelStatus === 'downloading' || modelStatus === 'initializing') && (
          <View style={styles.progressTrack}>
            <View
              style={[styles.progressBar, { width: `${modelProgress.progress}%` }]}
            />
          </View>
        )}
      </View>

      {/* Main Content Area */}
      <View style={styles.content}>
        {/* Live Text Box (Interim Segment) */}
        <View style={styles.liveBox}>
          <View style={styles.boxHeaderRow}>
            <View style={styles.boxLabelRow}>
              <MaterialIcons
                name="graphic-eq"
                size={16}
                color={isRecording ? '#EF4444' : '#64748B'}
              />
              <Text style={styles.boxTitle}>লাইভ কথা (Live Segment)</Text>
            </View>
            {isRecording && (
              <View style={styles.livePulseTag}>
                <View style={styles.liveRedDot} />
                <Text style={styles.liveTagText}>শুনছে...</Text>
              </View>
            )}
          </View>

          <ScrollView
            style={styles.liveTextScroll}
            contentContainerStyle={styles.liveScrollContainer}
            showsVerticalScrollIndicator={false}
          >
            {liveText ? (
              <Text style={styles.liveTextContent}>{liveText}</Text>
            ) : (
              <Text style={styles.placeholderText}>
                {isRecording
                  ? 'কথা বলুন, লাইভ টেক্সট এখানে দেখাবে...'
                  : 'মাইক অন করতে নিচের বাটনটি চাপুন...'}
              </Text>
            )}
          </ScrollView>
        </View>

        {/* Completed Text Box (Accumulated Finalized Transcript) */}
        <View style={styles.completedBox}>
          <View style={styles.boxHeaderRow}>
            <View style={styles.boxLabelRow}>
              <Ionicons name="document-text-outline" size={16} color="#6366F1" />
              <Text style={styles.boxTitle}>সম্পূর্ণ লেখা (Completed Transcript)</Text>
            </View>
            {completedText.length > 0 && (
              <Text style={styles.charCount}>
                {completedText.length} অক্ষর
              </Text>
            )}
          </View>

          <ScrollView
            style={styles.completedTextScroll}
            contentContainerStyle={styles.completedScrollContainer}
            showsVerticalScrollIndicator={true}
          >
            {completedText ? (
              <Text style={styles.completedTextContent}>{completedText}</Text>
            ) : (
              <Text style={styles.placeholderText}>
                চূড়ান্ত অনুলিপি এখানে জমা হবে...
              </Text>
            )}
          </ScrollView>
        </View>
      </View>

      {/* Floating Feedback Toast */}
      {toastMessage && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              opacity: toastAnim,
              transform: [
                {
                  translateY: toastAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [20, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Ionicons name="information-circle" size={18} color="#38BDF8" />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}

      {/* Bottom Action Bar per Wireframe: [Clean] (● Mic) [Copy] */}
      <View style={styles.bottomBar}>
        {/* Clean Button */}
        <TouchableOpacity
          style={[styles.actionBtn, styles.cleanBtn]}
          onPress={handleClean}
          activeOpacity={0.7}
        >
          <Ionicons name="trash-outline" size={20} color="#F87171" />
          <Text style={styles.cleanBtnText}>Clean</Text>
        </TouchableOpacity>

        {/* Center Mic Record Button */}
        <View style={styles.micWrapper}>
          {isRecording && (
            <Animated.View
              style={[
                styles.micPulseBg,
                { transform: [{ scale: pulseAnim }] },
              ]}
            />
          )}
          <TouchableOpacity
            style={[
              styles.micBtn,
              isRecording ? styles.micBtnRecording : styles.micBtnIdle,
              modelStatus !== 'ready' && styles.micBtnDisabled,
            ]}
            onPress={handleToggleRecording}
            activeOpacity={0.8}
            disabled={modelStatus !== 'ready'}
          >
            {modelStatus !== 'ready' ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Ionicons
                name={isRecording ? 'stop' : 'mic'}
                size={32}
                color="#FFFFFF"
              />
            )}
          </TouchableOpacity>
        </View>

        {/* Copy Button */}
        <TouchableOpacity
          style={[styles.actionBtn, styles.copyBtn]}
          onPress={handleCopy}
          activeOpacity={0.7}
        >
          <Ionicons name="copy-outline" size={20} color="#6366F1" />
          <Text style={styles.copyBtnText}>Copy</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },

  // Header styles
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#0F172A',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F8FAFC',
    letterSpacing: 0.3,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  offlineText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
    letterSpacing: 0.5,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#64748B',
  },
  statusDotReady: {
    backgroundColor: '#10B981',
  },
  statusDotBusy: {
    backgroundColor: '#F59E0B',
  },
  statusDotError: {
    backgroundColor: '#EF4444',
  },
  statusMessage: {
    fontSize: 12,
    color: '#94A3B8',
    flex: 1,
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#1E293B',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 2,
  },

  // Main content styles
  content: {
    flex: 1,
    padding: 16,
    gap: 14,
  },

  // Live text box
  liveBox: {
    height: 140,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  boxHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  boxLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  boxTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
  },
  livePulseTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  liveRedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  liveTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#EF4444',
  },
  liveTextScroll: {
    flex: 1,
  },
  liveScrollContainer: {
    flexGrow: 1,
  },
  liveTextContent: {
    fontSize: 17,
    lineHeight: 26,
    color: '#38BDF8',
    fontWeight: '500',
  },

  // Completed text box
  completedBox: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  completedTextScroll: {
    flex: 1,
  },
  completedScrollContainer: {
    flexGrow: 1,
  },
  completedTextContent: {
    fontSize: 18,
    lineHeight: 28,
    color: '#F8FAFC',
  },
  placeholderText: {
    fontSize: 15,
    color: '#64748B',
    fontStyle: 'italic',
  },
  charCount: {
    fontSize: 11,
    color: '#64748B',
  },

  // Toast container
  toastContainer: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0284C7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 100,
  },
  toastText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Bottom action bar styles
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  cleanBtn: {
    borderColor: 'rgba(248, 113, 113, 0.3)',
  },
  cleanBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F87171',
  },
  copyBtn: {
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  copyBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#818CF8',
  },

  // Mic Record Button
  micWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 72,
    height: 72,
  },
  micPulseBg: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(239, 68, 68, 0.35)',
  },
  micBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  micBtnIdle: {
    backgroundColor: '#6366F1',
  },
  micBtnRecording: {
    backgroundColor: '#EF4444',
  },
  micBtnDisabled: {
    backgroundColor: '#475569',
  },
});
