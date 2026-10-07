import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Permission,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { launchCamera, MediaType } from "react-native-image-picker";
import RNFS from "react-native-fs";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

type Status = "pending" | "syncing" | "synced" | "error";
type Kind = "photo" | "video";

type RecordItem = {
  id: string;
  name: string;
  notes: string;
  mediaKind?: Kind;
  mediaUri?: string;
  status: Status;
  attempts: number;
  lastError?: string;
  createdAt: string;
};

const STORAGE_KEY = "field_records_v2";
const MEDIA_DIR = `${RNFS.DocumentDirectoryPath}/captures`;

const COLORS: Record<Status, string> = {
  pending: "#F59E0B",
  syncing: "#3B82F6",
  synced: "#10B981",
  error: "#EF4444",
};

// Fake backend; fails when "Simulate server error" is on.
async function uploadRecord(_item: RecordItem, fail: boolean) {
  await new Promise<void>((r) => setTimeout(r, 1200));
  if (fail) throw new Error("Server unavailable (simulated)");
}

// Copy capture out of the cache into app storage so it survives restarts.
async function persistMedia(uri: string, ext: string) {
  await RNFS.mkdir(MEDIA_DIR);
  const dest = `${MEDIA_DIR}/${Date.now()}.${ext}`;
  await RNFS.copyFile(uri.replace("file://", ""), dest);
  return `file://${dest}`;
}

export default function App() {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [media, setMedia] = useState<{ kind: Kind; uri: string } | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [netOnline, setNetOnline] = useState(false);
  const [forceOffline, setForceOffline] = useState(false);
  const [failServer, setFailServer] = useState(false);

  const online = netOnline && !forceOffline;

  const recordsRef = useRef<RecordItem[]>([]);
  const syncing = useRef(false);
  const failRef = useRef(false);
  const onlineRef = useRef(false);
  failRef.current = failServer;
  onlineRef.current = online;

  const commit = useCallback(async (next: RecordItem[]) => {
    recordsRef.current = next;
    setRecords(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const patch = useCallback(
    (id: string, p: Partial<RecordItem>) =>
      commit(recordsRef.current.map((r) => (r.id === id ? { ...r, ...p } : r))),
    [commit]
  );

  const syncRecords = useCallback(async () => {
    if (syncing.current || !onlineRef.current) return;
    syncing.current = true;
    try {
      const queue = recordsRef.current.filter(
        (r) => r.status === "pending" || r.status === "error"
      );
      for (const item of queue) {
        if (!onlineRef.current) break; // went offline mid-sync; stay queued
        await patch(item.id, { status: "syncing", attempts: item.attempts + 1 });
        try {
          await uploadRecord(item, failRef.current);
          await patch(item.id, { status: "synced", lastError: undefined });
        } catch (e: any) {
          await patch(item.id, { status: "error", lastError: e?.message ?? "Upload failed" });
        }
      }
    } finally {
      syncing.current = false;
    }
  }, [patch]);

  // Load saved records; anything stuck on "syncing" after a crash goes back to pending.
  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const list: RecordItem[] = JSON.parse(saved).map((r: RecordItem) =>
          r.status === "syncing" ? { ...r, status: "pending" } : r
        );
        recordsRef.current = list;
        setRecords(list);
      }
    })();
    return NetInfo.addEventListener((s) =>
      setNetOnline(s.isConnected === true && s.isInternetReachable !== false)
    );
  }, []);

  // Retry whenever we come online.
  useEffect(() => {
    if (online) syncRecords();
  }, [online, syncRecords]);

  async function capture(type: MediaType) {
    if (Platform.OS === "android") {
      const perms: Permission[] = [PermissionsAndroid.PERMISSIONS.CAMERA];
      if (type === "video") perms.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      const res = await PermissionsAndroid.requestMultiple(perms);
      if (Object.values(res).some((v) => v !== "granted")) {
        return Alert.alert("Permission required", "Camera/microphone access denied.");
      }
    }
    const res = await launchCamera({ mediaType: type, quality: 0.6, saveToPhotos: false });
    if (res.didCancel) return;
    const asset = res.assets?.[0];
    if (res.errorCode || !asset?.uri) {
      return Alert.alert("Capture failed", res.errorMessage ?? "Unknown error");
    }
    const kind: Kind = type === "video" ? "video" : "photo";
    setMedia({ kind, uri: await persistMedia(asset.uri, kind === "video" ? "mp4" : "jpg") });
  }

  async function addRecord() {
    if (!name.trim()) return Alert.alert("Required", "Please enter a field name.");
    const record: RecordItem = {
      id: `${Date.now()}`,
      name: name.trim(),
      notes: notes.trim(),
      mediaKind: media?.kind,
      mediaUri: media?.uri,
      status: "pending",
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    await commit([record, ...recordsRef.current]);
    setName("");
    setNotes("");
    setMedia(null);
    syncRecords();
  }

  return (
    <SafeAreaProvider>
    <SafeAreaView style={s.container} edges={["top", "bottom"]}>
      <FlatList
        contentContainerStyle={s.content}
        data={records}
        keyExtractor={(i) => i.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Text style={s.title}>Offline Field Capture</Text>
            <View style={[s.network, { backgroundColor: online ? "#DCFCE7" : "#FEE2E2" }]}>
              <Text style={{ color: online ? "#166534" : "#991B1B" }}>
                {online ? "● Online" : "● Offline — data saved locally"}
              </Text>
            </View>

            <View style={s.row}>
              <Text style={s.small}>Force offline (demo)</Text>
              <Switch value={forceOffline} onValueChange={setForceOffline} />
            </View>
            <View style={s.row}>
              <Text style={s.small}>Simulate server error (demo)</Text>
              <Switch value={failServer} onValueChange={setFailServer} />
            </View>

            <Text style={s.label}>Field Name</Text>
            <TextInput value={name} onChangeText={setName} placeholder="e.g. Building A" style={s.input} />
            <Text style={s.label}>Notes</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Enter notes..."
              multiline
              style={[s.input, s.notes]}
            />

            <View style={s.row}>
              <TouchableOpacity style={[s.btn, s.flex, { backgroundColor: "#0F766E" }]} onPress={() => capture("photo")}>
                <Text style={s.btnText}>📷 Photo</Text>
              </TouchableOpacity>
              <View style={{ width: 10 }} />
              <TouchableOpacity style={[s.btn, s.flex, { backgroundColor: "#7C3AED" }]} onPress={() => capture("video")}>
                <Text style={s.btnText}>🎥 Record</Text>
              </TouchableOpacity>
            </View>

            {media && (
              <View style={s.attach}>
                {media.kind === "photo" ? (
                  <Image source={{ uri: media.uri }} style={s.thumb} />
                ) : (
                  <Text>🎥 Video clip attached</Text>
                )}
                <TouchableOpacity onPress={() => setMedia(null)}>
                  <Text style={s.link}>Remove</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={[s.btn, { backgroundColor: "#2563EB" }]} onPress={addRecord}>
              <Text style={s.btnText}>Save Record</Text>
            </TouchableOpacity>

            <View style={s.header}>
              <Text style={s.section}>Records ({records.length})</Text>
              <TouchableOpacity onPress={syncRecords}>
                <Text style={s.link}>Sync Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.name}>{item.name}</Text>
              <Text style={[s.status, { color: COLORS[item.status] }]}>{item.status.toUpperCase()}</Text>
            </View>
            <Text style={s.notesText}>{item.notes || "No notes"}</Text>
            {item.mediaKind === "photo" && item.mediaUri && (
              <Image source={{ uri: item.mediaUri }} style={s.cardImg} />
            )}
            {item.mediaKind === "video" && <Text style={s.notesText}>🎥 Video recording</Text>}
            {item.status === "error" && (
              <View style={s.row}>
                <Text style={s.err}>{item.lastError} · attempts: {item.attempts}</Text>
                <TouchableOpacity onPress={syncRecords}>
                  <Text style={s.link}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={s.date}>{new Date(item.createdAt).toLocaleString()}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>No records yet.</Text>}
      />
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F3F4F6" },
  content: { padding: 20, paddingTop: 30 },
  title: { fontSize: 28, fontWeight: "800", color: "#111827", marginBottom: 15 },
  network: { padding: 12, borderRadius: 10, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  flex: { flex: 1 },
  small: { color: "#374151" },
  label: { fontSize: 14, fontWeight: "700", marginBottom: 6, color: "#374151" },
  input: {
    backgroundColor: "#FFF", borderWidth: 1, borderColor: "#D1D5DB",
    borderRadius: 10, padding: 12, marginBottom: 15, fontSize: 16,
  },
  notes: { height: 90, textAlignVertical: "top" },
  btn: { padding: 15, borderRadius: 10, alignItems: "center", marginBottom: 10 },
  btnText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
  attach: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  thumb: { width: 70, height: 70, borderRadius: 8 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 15, marginBottom: 12 },
  section: { fontSize: 20, fontWeight: "800" },
  link: { color: "#2563EB", fontWeight: "700" },
  card: { backgroundColor: "#FFF", borderRadius: 12, padding: 15, marginBottom: 10 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 17, fontWeight: "700", flex: 1 },
  status: { fontSize: 11, fontWeight: "900" },
  notesText: { color: "#4B5563", marginTop: 8 },
  cardImg: { width: "100%", height: 140, borderRadius: 8, marginTop: 8 },
  err: { color: "#EF4444", fontSize: 12, flex: 1, marginTop: 6 },
  date: { color: "#9CA3AF", fontSize: 11, marginTop: 8 },
  empty: { textAlign: "center", color: "#9CA3AF", marginTop: 30 },
});
