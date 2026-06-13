#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ESP32Servo.h>
#include <HX711_ADC.h>
#include <RTClib.h>
#include <Wire.h>

// ============================================================
//  KONFIGURASI
// ============================================================
const char* WIFI_SSID     = "FCO";
const char* WIFI_PASSWORD = "aldi2024";
const char* DEVICE_ID     = "PKN-01";
const char* KOLAM_NAME    = "Kolam A";
const char* GAS_URL       = "https://script.google.com/macros/s/AKfycbx7FFhCIUoD7QCRfpxaunbCKSagYjQmjKKZybmsB_cYzJA9fWB6k5JEtROq73L6NzKoQQ/exec";

#define CALIBRATION_FACTOR  250516.55f
#define DEAD_ZONE_GRAM      2.0f

const float TARGET_GRAM = 500.0f;
const float TOLERANCE   = 20.0f;
const float SLOW_ZONE   = 100.0f;

// ============================================================
//  SERVO ANGLE
//  Center  = 90° (tutup / posisi netral)
//  Open    = 120° (+30° dari center → buka penuh)
//  SlowOpen= 105° (+15° dari center → buka lambat)
// ============================================================
#define SERVO_CENTER     90
#define SERVO_OPEN       60   // -30° dari center (kanan)
#define SERVO_OPEN_SLOW  75   // -15° dari center (zona lambat, kanan)

struct Schedule { uint8_t h; uint8_t m; bool on; };
Schedule schedules[] = {
  {  7,  0, true },
  { 12, 30, true },
  { 17,  0, true },
};
const int NUM_SCH = 3;

// ============================================================
//  PIN
// ============================================================
#define PIN_HX711_DOUT   4
#define PIN_HX711_SCK    5
#define PIN_SERVO       18
#define PIN_BTN         12
#define PIN_LED         13
#define I2C_SDA         21
#define I2C_SCL         22

// ============================================================
//  TIMING
// ============================================================
#define FEED_TIMEOUT_MS  30000UL
#define SCHED_CHECK_MS    1000UL
#define WIFI_RETRY_MS    30000UL
#define DEBOUNCE_MS        100UL
#define CMD_CHECK_MS        2000UL // check remote commands every 2s

// ============================================================
//  OBJEK
// ============================================================
HX711_ADC  scale(PIN_HX711_DOUT, PIN_HX711_SCK);
Servo      feederServo;
RTC_DS1307 rtc;

// ============================================================
//  STATE MACHINE
// ============================================================
enum State { IDLE, OPENING, FEEDING, CLOSING, DONE, ERR };
State state = IDLE;

float    wBefore      = 0;
float    wAfter       = 0;
float    dispensed    = 0;
uint32_t feedStart    = 0;
bool     isManual     = false;
String   lastStatus   = "IDLE";
int      sessionToday = 0;

uint8_t  lastFedH = 255, lastFedM = 255;

bool     btnStateLast  = HIGH;
uint32_t tDebounce     = 0;

uint32_t tSchedCheck = 0;
uint32_t tWifiRetry  = 0;
uint32_t tCmdCheck = 0; // timestamp for remote command polling

// ============================================================
//  FORWARD DECLARATION
// ============================================================
float  readStableKg();
void   warmUp(int n);
void   connectWiFi();
void   checkSchedule();
void   handleButton();
void   processSerial();
void   sendLog();
void   ledBlink(int n, int ms);
void   blinkErr(int n);
void   updateLED();
String pad2(int v);
void   runFSM();
void   checkRemoteCommand();

// ============================================================
//  SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(400);

  pinMode(PIN_BTN, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  feederServo.setPeriodHertz(50);
  feederServo.attach(PIN_SERVO, 500, 2400);

  // Posisi awal: tutup (center)
  feederServo.write(SERVO_CENTER);
  delay(1000);

  Wire.begin(I2C_SDA, I2C_SCL);
  if (!rtc.begin()) {
    Serial.println("[RTC] TIDAK DITEMUKAN");
    blinkErr(5);
  } else {
    if (!rtc.isrunning())
      rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    DateTime now = rtc.now();
    Serial.printf("[RTC] %02d:%02d:%02d %02d/%02d/%04d\n",
      now.hour(), now.minute(), now.second(),
      now.day(), now.month(), now.year());
  }

  scale.begin();
  scale.setCalFactor(CALIBRATION_FACTOR);
  Serial.print("[HX711] Init");
  uint32_t t0 = millis();
  while (!scale.update()) {
    if (millis() - t0 > 5000) { Serial.println(" timeout"); break; }
    Serial.print(".");
    delay(200);
  }
  Serial.println(" OK");
  warmUp(20);
  scale.tare();
  warmUp(20);
  Serial.printf("[HX711] Tare OK. Val: %.4f kg\n", scale.getData());

  connectWiFi();
  ledBlink(3, 100);
  Serial.println("[SYSTEM] Siap.");
  Serial.println("[INFO]   Servo terbuka maks 30 derajat dari center (90 -> 120)");
  Serial.printf("[INFO]   SERVO_CENTER=%d SERVO_OPEN=%d SERVO_OPEN_SLOW=%d\n",
                SERVO_CENTER, SERVO_OPEN, SERVO_OPEN_SLOW);
}

// ============================================================
//  LOOP
// ============================================================
// Main loop
void loop() {
  scale.update();
  handleButton();

  if (!WiFi.isConnected() && millis() - tWifiRetry > WIFI_RETRY_MS) {
    tWifiRetry = millis();
    connectWiFi();
  }

  if (state == IDLE && millis() - tSchedCheck > SCHED_CHECK_MS) {
    tSchedCheck = millis();
    checkSchedule();
  }

  // Remote command polling
  if (millis() - tCmdCheck > CMD_CHECK_MS) {
    tCmdCheck = millis();
    checkRemoteCommand();
  }

  runFSM();
  updateLED();
  processSerial();
}

// ============================================================
//  LATCHING BUTTON HANDLER
// ============================================================
void handleButton() {
  bool btnNow = digitalRead(PIN_BTN);

  if (btnNow == btnStateLast) return;
  if (millis() - tDebounce < DEBOUNCE_MS) return;
  tDebounce = millis();

  btnStateLast = btnNow;

  if (btnNow == LOW) {
    Serial.println("[BTN] Ditekan (tertahan) -> Manual feed");
    if (state == IDLE) {
      isManual = true;
      state    = OPENING;
    } else {
      Serial.println("[BTN] Feeding sedang berjalan, abaikan");
    }
  } else {
    Serial.println("[BTN] Dilepas -> Stop paksa");
    if (state == FEEDING || state == OPENING) {
      lastStatus = "MANUAL_STOP";
      state      = CLOSING;
    }
  }
}

// ============================================================
//  STATE MACHINE
// ============================================================
void runFSM() {
  switch (state) {

    case IDLE:
      break;

    case OPENING: {
      lastStatus = "OPENING";
      warmUp(10);
      wBefore = readStableKg() * 1000.0f;
      Serial.printf("[FEED] Berat awal: %.1f g\n", wBefore);
      feederServo.write(SERVO_OPEN);   // buka 30° dari center
      feedStart = millis();
      state     = FEEDING;
      break;
    }

    case FEEDING: {
      scale.update();
      float wNow = readStableKg() * 1000.0f;
      dispensed  = wBefore - wNow;
      float sisa = TARGET_GRAM - dispensed;
      Serial.printf("[FEED] Terkirim: %.1f g | Sisa: %.1f g\n", dispensed, sisa);

      // Zona lambat: kurangi bukaan servo ke setengah (15°)
      if (sisa <= SLOW_ZONE && sisa > TOLERANCE)
        feederServo.write(SERVO_OPEN_SLOW);

      if (dispensed >= TARGET_GRAM - TOLERANCE) {
        lastStatus = "DONE";
        state      = CLOSING;
        break;
      }

      if (millis() - feedStart > FEED_TIMEOUT_MS) {
        Serial.println("[FEED] TIMEOUT");
        lastStatus = "TIMEOUT";
        state      = CLOSING;
        break;
      }

      delay(200);
      break;
    }

    case CLOSING: {
      feederServo.write(SERVO_CENTER);   // tutup kembali ke center
      delay(600);
      wAfter    = readStableKg() * 1000.0f;
      dispensed = wBefore - wAfter;
      Serial.printf("[FEED] Selesai. Dispensed: %.1f g | Status: %s\n",
                    dispensed, lastStatus.c_str());
      state = DONE;
      break;
    }

    case DONE: {
      sessionToday++;
      sendLog();
      ledBlink(5, 150);
      state    = IDLE;
      isManual = false;
      Serial.println("[FEED] Kembali IDLE");
      break;
    }

    case ERR: {
      feederServo.write(SERVO_CENTER);
      blinkErr(3);
      lastStatus = "ERROR";
      state      = IDLE;
      break;
    }
  }
}

// ============================================================
//  BACA BERAT STABIL
// ============================================================
float readStableKg() {
  float sum = 0; int valid = 0;
  for (int i = 0; i < 10; i++) {
    scale.update();
    float v = scale.getData();
    if (v > -10.0f && v < 10.0f) { sum += v; valid++; }
    delay(50);
  }
  float avg = valid > 0 ? sum / valid : 0.0f;
  if (fabsf(avg) < DEAD_ZONE_GRAM / 1000.0f) avg = 0.0f;
  return avg;
}

void warmUp(int n) {
  for (int i = 0; i < n; i++) { scale.update(); delay(50); }
}

// ============================================================
//  CEK JADWAL
// ============================================================
void checkSchedule() {
  DateTime now = rtc.now();
  uint8_t h = now.hour(), m = now.minute();
  if (h == lastFedH && m == lastFedM) return;
  for (int i = 0; i < NUM_SCH; i++) {
    if (!schedules[i].on) continue;
    if (schedules[i].h == h && schedules[i].m == m) {
      Serial.printf("[SCHED] Jadwal %02d:%02d\n", h, m);
      lastFedH = h; lastFedM = m;
      isManual = false;
      state    = OPENING;
      return;
    }
  }
}

// ============================================================
//  KIRIM LOG KE GOOGLE SHEETS
// ============================================================
void sendLog() {
  if (!WiFi.isConnected()) { Serial.println("[HTTP] No WiFi"); return; }

  DateTime now = rtc.now();
  String sesi  = isManual ? "MANUAL" :
                 (now.hour() < 10 ? "PAGI" :
                  now.hour() < 15 ? "SIANG" : "SORE");

  String url = String(GAS_URL)
    + "?action=feed_log"
    + "&device_id="   + DEVICE_ID
    + "&kolam="       + KOLAM_NAME
    + "&sesi="        + sesi
    + "&target_g="    + String(TARGET_GRAM, 0)
    + "&dispensed_g=" + String(dispensed, 1)
    + "&status="      + lastStatus
    + "&manual="      + (isManual ? "1" : "0")
    + "&jam="         + pad2(now.hour()) + ":" + pad2(now.minute())
    + "&tanggal="     + String(now.day()) + "/" + String(now.month()) + "/" + String(now.year());

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;
  https.setTimeout(8000);
  if (https.begin(client, url)) {
    int code = https.GET();
    Serial.printf("[HTTP] %d  %s\n", code, https.getString().c_str());
    https.end();
  }
  delay(1000);
}

// ============================================================
//  WIFI
// ============================================================
void connectWiFi() {
  Serial.printf("[WiFi] Konek ke %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500); Serial.print(".");
  }
  if (WiFi.isConnected())
    Serial.printf("\n[WiFi] OK IP: %s\n", WiFi.localIP().toString().c_str());
  else
    Serial.println("\n[WiFi] Gagal, retry nanti.");
}

// ============================================================
//  SERIAL COMMAND HANDLER
// ============================================================
void processSerial() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  if (cmd.equalsIgnoreCase("OPEN")) {
    Serial.printf("[CMD] Opening servo -> %d deg\n", SERVO_OPEN);
    feederServo.write(SERVO_OPEN);
  } else if (cmd.equalsIgnoreCase("CLOSE")) {
    Serial.printf("[CMD] Closing servo -> %d deg\n", SERVO_CENTER);
    feederServo.write(SERVO_CENTER);
  } else if (cmd.equalsIgnoreCase("FEED")) {
    if (state == IDLE) {
      isManual = true;
      state    = OPENING;
      Serial.println("[CMD] Feed dimulai");
    } else {
      Serial.println("[CMD] Feeding sedang berjalan");
    }
  } else if (cmd.equalsIgnoreCase("STATUS")) {
    Serial.printf("[CMD] State=%d | Dispensed=%.1fg | Session=%d\n",
                  state, dispensed, sessionToday);
  } else {
    Serial.println("[CMD] Perintah: OPEN / CLOSE / FEED / STATUS");
  }
}

// ============================================================
//  LED & HELPER
// ============================================================
void ledBlink(int n, int ms) {
  for (int i = 0; i < n; i++) {
    digitalWrite(PIN_LED, HIGH); delay(ms);
    digitalWrite(PIN_LED, LOW);  delay(ms);
  }
}

void blinkErr(int n) {
  for (int i = 0; i < n; i++) {
    digitalWrite(PIN_LED, HIGH); delay(200);
    digitalWrite(PIN_LED, LOW);  delay(100);
  }
}

void updateLED() {
  static uint32_t t = 0;
  static bool     s = false;
  uint32_t iv = (state == IDLE) ? 1000 : 150;
  if (millis() - t > iv) { t = millis(); s = !s; digitalWrite(PIN_LED, s); }
}

String pad2(int v) { return v < 10 ? "0" + String(v) : String(v); }
