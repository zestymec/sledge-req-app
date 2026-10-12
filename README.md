# Field Capture

React Native + TypeScript prototype for capturing photos and videos in the field without a connection.

- Captures are copied into app storage and the queue is kept in AsyncStorage, so nothing is lost on restart.
- Each capture moves through `pending → syncing → synced`, or `error` if the upload fails.
- When the device comes back online, pending and failed items are retried automatically. They can also be retried by hand.

The upload in `uploadCapture` is a placeholder that only checks connectivity. Swap in the real API call there.

## Run

```sh
npm install
cd ios && pod install && cd ..
npm run ios       # or: npm run android
```

Requires Node 22.11+, Xcode for iOS, and Android Studio for Android.

## Test

```sh
npm test
npm run lint
```
