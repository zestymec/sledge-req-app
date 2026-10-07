npx create-expo-app@latest offline-field-capture --template blank-typescript

cd offline-field-capture

npx expo install @react-native-async-storage/async-storage
npm install @react-native-community/netinfo



import React, { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

type Status =
  | "pending"
  | "syncing"
  | "synced"
  | "error";

type RecordItem = {
  id: string;
  name: string;
  notes: string;
  status: Status;
  createdAt: string;
};

const STORAGE_KEY = "field_records";

export default function App() {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  const [records, setRecords] = useState<RecordItem[]>(
    []
  );

  const [online, setOnline] = useState(false);

  // Load saved records when app starts
  useEffect(() => {
    loadRecords();

    const unsubscribe = NetInfo.addEventListener(
      (state) => {
        const connected = state.isConnected === true;

        setOnline(connected);

        if (connected) {
          syncRecords();
        }
      }
    );

    return unsubscribe;
  }, []);

  async function loadRecords() {
    const saved = await AsyncStorage.getItem(
      STORAGE_KEY
    );

    if (saved) {
      setRecords(JSON.parse(saved));
    }
  }

  async function saveRecords(
    newRecords: RecordItem[]
  ) {
    setRecords(newRecords);

    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(newRecords)
    );
  }

  async function addRecord() {
    if (!name.trim()) {
      Alert.alert(
        "Required",
        "Please enter a field name."
      );
      return;
    }

    const record: RecordItem = {
      id: Date.now().toString(),
      name: name.trim(),
      notes: notes.trim(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    const newRecords = [record, ...records];

    await saveRecords(newRecords);

    setName("");
    setNotes("");

    // If internet is available, try immediately
    if (online) {
      syncRecords(newRecords);
    }
  }

  async function syncRecords(
    currentRecords = records
  ) {
    const pending = currentRecords.filter(
      (item) =>
        item.status === "pending" ||
        item.status === "error"
    );

    if (pending.length === 0) {
      return;
    }

    let updated = [...currentRecords];

    for (const item of pending) {
      // syncing
      updated = updated.map((record) =>
        record.id === item.id
          ? {
              ...record,
              status: "syncing",
            }
          : record
      );

      await saveRecords(updated);

      // Simulate API request
      await new Promise((resolve) =>
        setTimeout(resolve, 1000)
      );

      // Successful upload
      updated = updated.map((record) =>
        record.id === item.id
          ? {
              ...record,
              status: "synced",
            }
          : record
      );

      await saveRecords(updated);
    }
  }

  function getStatusColor(status: Status) {
    switch (status) {
      case "pending":
        return "#F59E0B";

      case "syncing":
        return "#3B82F6";

      case "synced":
        return "#10B981";

      case "error":
        return "#EF4444";
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>
          Offline Field Capture
        </Text>

        <View
          style={[
            styles.network,
            {
              backgroundColor: online
                ? "#DCFCE7"
                : "#FEE2E2",
            },
          ]}
        >
          <Text
            style={{
              color: online
                ? "#166534"
                : "#991B1B",
            }}
          >
            {online
              ? "● Online"
              : "● Offline — data saved locally"}
          </Text>
        </View>

        <Text style={styles.label}>
          Field Name
        </Text>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Building A"
          style={styles.input}
        />

        <Text style={styles.label}>
          Notes
        </Text>

        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Enter notes..."
          multiline
          style={[
            styles.input,
            styles.notes,
          ]}
        />

        <TouchableOpacity
          style={styles.saveButton}
          onPress={addRecord}
        >
          <Text style={styles.saveText}>
            Save Record
          </Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.sectionTitle}>
            Records
          </Text>

          <TouchableOpacity
            onPress={() => syncRecords()}
          >
            <Text style={styles.syncText}>
              Sync Now
            </Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={records}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.name}>
                  {item.name}
                </Text>

                <Text
                  style={[
                    styles.status,
                    {
                      color: getStatusColor(
                        item.status
                      ),
                    },
                  ]}
                >
                  {item.status.toUpperCase()}
                </Text>
              </View>

              <Text style={styles.notesText}>
                {item.notes || "No notes"}
              </Text>

              <Text style={styles.date}>
                {new Date(
                  item.createdAt
                ).toLocaleString()}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No records yet.
            </Text>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F3F4F6",
  },

  content: {
    flex: 1,
    padding: 20,
  },

  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 15,
  },

  network: {
    padding: 12,
    borderRadius: 10,
    marginBottom: 20,
  },

  label: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 6,
    color: "#374151",
  },

  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    padding: 12,
    marginBottom: 15,
    fontSize: 16,
  },

  notes: {
    height: 90,
    textAlignVertical: "top",
  },

  saveButton: {
    backgroundColor: "#2563EB",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },

  saveText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 25,
    marginBottom: 12,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "800",
  },

  syncText: {
    color: "#2563EB",
    fontWeight: "700",
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
  },

  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  name: {
    fontSize: 17,
    fontWeight: "700",
    flex: 1,
  },

  status: {
    fontSize: 11,
    fontWeight: "900",
  },

  notesText: {
    color: "#4B5563",
    marginTop: 8,
  },

  date: {
    color: "#9CA3AF",
    fontSize: 11,
    marginTop: 8,
  },

  empty: {
    textAlign: "center",
    color: "#9CA3AF",
    marginTop: 30,
  },
});
Message Ahad Saleem