import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Permission,
  PermissionsAndroid,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { launchCamera, MediaType } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

type Status = 'pending' | 'syncing' | 'synced' | 'error';
type Kind = 'photo' | 'video';

type Capture = {
  id: string;
  kind: Kind;
  uri: string;
  duration?: number;
  status: Status;
  attempts: number;
  lastError?: string;
  createdAt: string;
};

const STORAGE_KEY = 'field_captures_v3';
const MEDIA_DIR = `${RNFS.DocumentDirectoryPath}/captures`;
const STATUSES: Status[] = ['pending', 'syncing', 'synced', 'error'];

const C = {
  bg: '#F6F5F2',
  surface: '#FFFFFF',
  ink: '#1A1A1A',
  muted: '#77756F',
  line: '#E4E2DC',
  pending: '#B7791F',
  syncing: '#2F6FB0',
  synced: '#2F7D4F',
  error: '#B83A3A',
};

async function uploadCapture(_item: Capture) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch('https://clients3.google.com/generate_204', {
      method: 'HEAD',
      signal: ctrl.signal,
    });
    if (!res.ok && res.status !== 204) throw new Error(`Server ${res.status}`);
  } catch (e: any) {
    throw new Error(e?.name === 'AbortError' ? 'Timed out' : 'No connection');
  } finally {
    clearTimeout(t);
  }
  await new Promise<void>(r => setTimeout(r, 900));
}

async function persistMedia(uri: string, ext: string) {
  await RNFS.mkdir(MEDIA_DIR);
  const dest = `${MEDIA_DIR}/${Date.now()}.${ext}`;
  await RNFS.copyFile(uri.replace('file://', ''), dest);
  return `file://${dest}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(sec?: number) {
  if (!sec) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Separator() {
  return <View style={s.sep} />;
}

export default function App() {
  const [items, setItems] = useState<Capture[]>([]);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);

  const itemsRef = useRef<Capture[]>([]);
  const syncing = useRef(false);
  const onlineRef = useRef(false);
  onlineRef.current = online;

  const commit = useCallback(async (next: Capture[]) => {
    itemsRef.current = next;
    setItems(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const patch = useCallback(
    (id: string, p: Partial<Capture>) =>
      commit(itemsRef.current.map(r => (r.id === id ? { ...r, ...p } : r))),
    [commit],
  );

  const sync = useCallback(async () => {
    if (syncing.current) return;
    const queue = itemsRef.current.filter(
      r => r.status === 'pending' || r.status === 'error',
    );
    if (!queue.length) return;

    if (!onlineRef.current) {
      await commit(
        itemsRef.current.map(r =>
          queue.includes(r)
            ? { ...r, status: 'error', lastError: 'Offline — will retry' }
            : r,
        ),
      );
      return;
    }

    syncing.current = true;
    setBusy(true);
    try {
      for (const item of queue) {
        if (!onlineRef.current) break;
        await patch(item.id, {
          status: 'syncing',
          attempts: item.attempts + 1,
        });
        try {
          await uploadCapture(item);
          await patch(item.id, { status: 'synced', lastError: undefined });
        } catch (e: any) {
          await patch(item.id, {
            status: 'error',
            lastError: e?.message ?? 'Upload failed',
          });
        }
      }
    } finally {
      syncing.current = false;
      setBusy(false);
    }
  }, [commit, patch]);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const list: Capture[] = JSON.parse(saved).map((r: Capture) =>
          r.status === 'syncing' ? { ...r, status: 'pending' } : r,
        );
        itemsRef.current = list;
        setItems(list);
      }
    })();
    return NetInfo.addEventListener(s =>
      setOnline(s.isConnected === true && s.isInternetReachable !== false),
    );
  }, []);

  useEffect(() => {
    if (online) sync();
  }, [online, sync]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = {
      pending: 0,
      syncing: 0,
      synced: 0,
      error: 0,
    };
    items.forEach(i => c[i.status]++);
    return c;
  }, [items]);

  async function capture(type: MediaType) {
    if (Platform.OS === 'android') {
      const perms: Permission[] = [PermissionsAndroid.PERMISSIONS.CAMERA];
      if (type === 'video')
        perms.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      const res = await PermissionsAndroid.requestMultiple(perms);
      if (Object.values(res).some(v => v !== 'granted')) {
        return Alert.alert(
          'Permission needed',
          'Allow camera access to capture.',
        );
      }
    }
    const res = await launchCamera({
      mediaType: type,
      quality: 0.6,
      videoQuality: 'medium',
      saveToPhotos: false,
    });
    if (res.didCancel) return;
    const asset = res.assets?.[0];
    if (res.errorCode || !asset?.uri) {
      return Alert.alert('Capture failed', res.errorMessage ?? 'Unknown error');
    }
    const kind: Kind = type === 'video' ? 'video' : 'photo';
    const item: Capture = {
      id: `${Date.now()}`,
      kind,
      uri: await persistMedia(asset.uri, kind === 'video' ? 'mp4' : 'jpg'),
      duration: asset.duration,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    await commit([item, ...itemsRef.current]);
    if (onlineRef.current) sync();
  }

  const queued = counts.pending + counts.error;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        <View style={s.top}>
          <Text style={s.title}>Field Capture</Text>
          <View style={s.conn}>
            <View
              style={[s.dot, { backgroundColor: online ? C.synced : C.muted }]}
            />
            <Text style={s.connText}>{online ? 'Online' : 'Offline'}</Text>
          </View>
        </View>

        <View style={s.captureRow}>
          <Pressable
            style={({ pressed }) => [s.captureBtn, pressed && s.pressed]}
            onPress={() => capture('photo')}
          >
            <Text style={s.captureLabel}>Photo</Text>
            <Text style={s.captureHint}>Take a picture</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.captureBtn, pressed && s.pressed]}
            onPress={() => capture('video')}
          >
            <Text style={s.captureLabel}>Video</Text>
            <Text style={s.captureHint}>Record a clip</Text>
          </Pressable>
        </View>

        <View style={s.stats}>
          {STATUSES.map(st => (
            <View key={st} style={s.stat}>
              <Text style={[s.statNum, { color: counts[st] ? C[st] : C.ink }]}>
                {counts[st]}
              </Text>
              <Text style={s.statLabel}>{st}</Text>
            </View>
          ))}
        </View>

        <View style={s.listHead}>
          <Text style={s.section}>Captures</Text>
          <Pressable
            onPress={sync}
            disabled={busy || !queued}
            style={({ pressed }) => [
              s.syncBtn,
              (busy || !queued) && s.syncBtnOff,
              pressed && s.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={C.surface} />
            ) : (
              <Text style={s.syncText}>
                {queued ? `Sync ${queued}` : 'All synced'}
              </Text>
            )}
          </Pressable>
        </View>

        <FlatList
          data={items}
          keyExtractor={i => i.id}
          contentContainerStyle={s.list}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={
            <Text style={s.empty}>
              Nothing captured yet.{'\n'}Photos and videos are saved on the
              device and uploaded when you're online.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={s.row}>
              {item.kind === 'photo' ? (
                <Image source={{ uri: item.uri }} style={s.thumb} />
              ) : (
                <View style={[s.thumb, s.videoThumb]}>
                  <View style={s.play} />
                  {!!item.duration && (
                    <Text style={s.dur}>{formatDuration(item.duration)}</Text>
                  )}
                </View>
              )}

              <View style={s.rowBody}>
                <Text style={s.rowTitle}>
                  {item.kind === 'photo' ? 'Photo' : 'Video'}
                </Text>
                <Text style={s.rowMeta}>{formatTime(item.createdAt)}</Text>
                {item.status === 'error' && (
                  <Text style={s.rowErr} numberOfLines={1}>
                    {item.lastError}
                    {item.attempts > 0 ? ` · ${item.attempts} tries` : ''}
                  </Text>
                )}
              </View>

              <View style={s.rowRight}>
                <View style={s.badge}>
                  {item.status === 'syncing' ? (
                    <ActivityIndicator size="small" color={C.syncing} />
                  ) : (
                    <View
                      style={[s.dot, { backgroundColor: C[item.status] }]}
                    />
                  )}
                  <Text style={[s.badgeText, { color: C[item.status] }]}>
                    {item.status}
                  </Text>
                </View>
                {item.status === 'error' && (
                  <Pressable onPress={sync} hitSlop={8}>
                    <Text style={s.retry}>Retry</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  title: { fontSize: 22, fontWeight: '600', color: C.ink, letterSpacing: -0.3 },
  conn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    backgroundColor: C.surface,
  },
  connText: { fontSize: 13, color: C.ink },
  dot: { width: 7, height: 7, borderRadius: 4 },

  captureRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20 },
  captureBtn: {
    flex: 1,
    backgroundColor: C.ink,
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  captureLabel: { color: C.surface, fontSize: 17, fontWeight: '600' },
  captureHint: { color: '#A8A6A0', fontSize: 13, marginTop: 2 },
  pressed: { opacity: 0.75 },

  stats: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    paddingVertical: 12,
  },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '600' },
  statLabel: { fontSize: 12, color: C.muted, marginTop: 2 },

  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 8,
  },
  section: { fontSize: 15, fontWeight: '600', color: C.ink },
  syncBtn: {
    backgroundColor: C.ink,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 32,
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBtnOff: { backgroundColor: '#B9B7B0' },
  syncText: { color: C.surface, fontSize: 13, fontWeight: '600' },

  list: { paddingHorizontal: 20, paddingBottom: 24 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: C.line },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  thumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: C.line },
  videoThumb: {
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftWidth: 12,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#FFFFFF',
  },
  dur: {
    position: 'absolute',
    bottom: 3,
    right: 5,
    fontSize: 10,
    color: '#FFFFFF',
  },
  rowBody: { flex: 1, marginLeft: 12 },
  rowTitle: { fontSize: 15, fontWeight: '500', color: C.ink },
  rowMeta: { fontSize: 13, color: C.muted, marginTop: 2 },
  rowErr: { fontSize: 12, color: C.error, marginTop: 3 },
  rowRight: { alignItems: 'flex-end', gap: 6, marginLeft: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeText: { fontSize: 13, fontWeight: '500' },
  retry: { fontSize: 13, fontWeight: '600', color: C.ink },

  empty: {
    textAlign: 'center',
    color: C.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 40,
  },
});
