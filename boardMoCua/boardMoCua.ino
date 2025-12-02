#include <ArduinoWebsockets.h>
#include <ESP8266WiFi.h>
#include <SPI.h>
#include <MFRC522.h>

using namespace websockets;


const char* WIFI_SSID = "P601";
const char* WIFI_PASS = "phong601@"; //neu ban la nguoi tot, xin dung coi lai commit cu de thay pass wifi nha toi. cam on ban
const char* WS_URL = "wss://doantonghopiot.namanhishere.com/ws";
const char* ROOM_ID = "101"; 

#define SS_PIN    4   
#define RST_PIN   5   
#define RELAY_PIN 16  



MFRC522 mfrc522(SS_PIN, RST_PIN);
WebsocketsClient client;
unsigned long lastPing = 0;
const unsigned long PING_INTERVAL = 15000; 


unsigned long relayOffTime = 0;
const unsigned long AUTO_CLOSE_DELAY = 1000; 

void setup() {
  Serial.begin(115200);
  delay(10);
  Serial.println();
  Serial.println("ESP8266 RFID WSS Client");

  
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  
  WiFi.begin(WIFI_SSID, WIFI_PASS);//wai phai
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected. IP: ");
  Serial.println(WiFi.localIP());

  
  SPI.begin();
  mfrc522.PCD_Init();//rờ ép ai đi
  Serial.println("RC522 ready.");

  
  client.onMessage(onMessageCallback);
  client.onEvent(onEventCallback);
  connectWebSocket();
}

void loop() {
  if (client.available()) client.poll();
  
  if (millis() - lastPing > PING_INTERVAL) {
    client.ping();
    lastPing = millis();
  }

  
  if (relayOffTime > 0 && millis() >= relayOffTime) {
    Serial.println("Auto-closing door");
    digitalWrite(RELAY_PIN, LOW);
    relayOffTime = 0; 
  }

  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial())
    return;

  String uidStr = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) uidStr += "0";
    uidStr += String(mfrc522.uid.uidByte[i], HEX);
  }
  uidStr.toUpperCase();

  Serial.print("Card UID: ");
  Serial.println(uidStr);

  
  String json = "{\"type\":\"rfid\",\"room\":\"" + String(ROOM_ID) + "\",\"uid\":\"" + uidStr + "\"}";
  client.send(json);

  mfrc522.PICC_HaltA();
  delay(1000); 
}


void connectWebSocket() {
  Serial.println("Connecting to WebSocket...");// web shock két
  if (client.connect(WS_URL)) {
    Serial.println("WebSocket connected!");
    
    
    String identifyMsg = "{\"type\":\"identification\",\"room\":\"" + String(ROOM_ID) + "\"}";
    client.send(identifyMsg);
    
  } else {
    Serial.println("WebSocket connection failed!");
    delay(3000);
    connectWebSocket();
  }
}


void onMessageCallback(WebsocketsMessage msg) {
  Serial.println("WS message: " + msg.data());
  String data = msg.data(); 

  if (data.indexOf("\"AUTHORIZED\"") != -1) {
    Serial.println("Access granted");
    digitalWrite(RELAY_PIN, HIGH);
    relayOffTime = millis() + AUTO_CLOSE_DELAY; 
  }
  else if (data.indexOf("\"DENIED\"") != -1) {
    Serial.println("Access denied");
  }
  
  else if (data == "OPEN_DOOR") {
    Serial.println("Remote OPEN_DOOR command received");
    digitalWrite(RELAY_PIN, HIGH);
    relayOffTime = millis() + AUTO_CLOSE_DELAY; 
  }
  // else if (data == "CLOSE_DOOR") {
  //   Serial.println("Remote CLOSE_DOOR command received");
  //   digitalWrite(RELAY_PIN, LOW);
  //   relayOffTime = 0; 
  // }
}

void onEventCallback(WebsocketsEvent event, String data) {
  if (event == WebsocketsEvent::ConnectionClosed) {
    Serial.println("WebSocket closed, reconnecting...");
    connectWebSocket();
  } 
}