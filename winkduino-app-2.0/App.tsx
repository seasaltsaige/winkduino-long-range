import React, { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import base64 from "react-native-base64";
import { useBLE } from './hooks/useBLE';
import { useEffect, useState } from 'react';
import { DefaultCommands } from "./Pages/DefaultCommands";
import { CreateCustomCommands } from './Pages/CreateCustomCommands';
import { CustomCommands } from './Pages/CustomCommands';
import { DeviceMACStore } from './AsyncStorage/DeviceMACStore';
import { Settings } from './Pages/Settings';
import { OpacityButton } from './Components/OpacityButton';
import { AutoConnectStore } from './AsyncStorage';
import { AppTheme } from './Pages/AppTheme';
import { useColorTheme } from './hooks/useColorTheme';
import { buttonBehaviorMap, ButtonBehaviors, CustomOEMButtonStore } from './AsyncStorage/CustomOEMButtonStore';
import WifiManager from 'react-native-wifi-reborn';
//test

import {
  SERVICE_UUID,
  CUSTOM_BUTTON_UPDATE_UUID,
  FIRMWARE_UUID,
  LEFT_SLEEPY_EYE_UUID,
  LONG_TERM_SLEEP_UUID,
  REQUEST_CHAR_UUID,
  RIGHT_SLEEPY_EYE_UUID,
  SYNC_UUID,
  UPDATE_URL
} from './helper/Constants';

import {
  generatePassword,
  sleep,
} from "./helper/Functions";

enum UpdateStates {
  CLOSED,
  PROMPT,
  ACCEPTED,
  DENIED,
  FAILED,
  SUCCESS,
}

export default function App() {

  const {
    requestPermissions,
    scan,
    disconnect,
    connectedDevice,
    headlightsBusy,
    leftState,
    rightState,
    isConnecting,
    isScanning,
    noDevice,
    MAC,
    updateProgress,
    updatingStatus
  } = useBLE();

  const [defaultCommandsOpen, setDefaultCommandsOpen] = useState(false);
  const [createCustomOpen, setCreateCustomOpen] = useState(false);
  const [customPresetOpen, setCustomPresetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appThemeOpen, setAppThemeOpen] = useState(false);

  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [promptResponse, setPromptResponse] = useState(UpdateStates.CLOSED);
  const [firmwareDescription, setFirmwareDescription] = useState("");
  const [firmwareVersions, setFirmwareVersions] = useState({ old: "", new: "" });
  const [wifiConnected, setWifiConnected] = useState(false);

  const [autoConnect, setAutoConnect] = useState(true);

  const [_, setMAC] = useState<string | undefined>();

  const { colorTheme, update } = useColorTheme();

  const scanForDevice = async () => {
    const permsEnabled = await requestPermissions();
    if (permsEnabled) {
      await scan();
    }
  }

  const sendDefaultCommand = (value: number) => {
    if (headlightsBusy) return;
    if (connectedDevice)
      connectedDevice.writeCharacteristicWithoutResponseForService(SERVICE_UUID, REQUEST_CHAR_UUID, base64.encode(value.toString())).catch(err => console.log(err));
  }

  const sendSleepCommand = (left: number, right: number) => {
    if (headlightsBusy) return;
    if (connectedDevice) {
      connectedDevice.writeCharacteristicWithoutResponseForService(SERVICE_UUID, LEFT_SLEEPY_EYE_UUID, base64.encode(left.toString())).catch(err => console.log(err));
      connectedDevice.writeCharacteristicWithoutResponseForService(SERVICE_UUID, RIGHT_SLEEPY_EYE_UUID, base64.encode(right.toString())).catch(err => console.log(err));
    }
  }

  const sendSyncSignal = () => {
    if (headlightsBusy) return;
    if (connectedDevice)
      connectedDevice.writeCharacteristicWithoutResponseForService(SERVICE_UUID, SYNC_UUID, base64.encode("1"));
  }

  const enterDeepSleep = async () => {
    if (!connectedDevice) return;
    try {
      await connectedDevice.writeCharacteristicWithoutResponseForService(SERVICE_UUID, LONG_TERM_SLEEP_UUID, base64.encode("1"));
      await disconnect();
    } catch (err) {
      console.log("ERROR SLEEPING");
      console.log(err);
    }
  }

  const updateOEMButtonPresets = async (presses: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10, to: ButtonBehaviors) => {
    //@ts-ignore
    if (to === 0)
      await CustomOEMButtonStore.remove(presses);
    else
      await CustomOEMButtonStore.set(presses, to);

    await connectedDevice?.writeCharacteristicWithoutResponseForService(SERVICE_UUID, CUSTOM_BUTTON_UPDATE_UUID, base64.encode((presses).toString()));
    await sleep(20);
    //@ts-ignore
    await connectedDevice?.writeCharacteristicWithoutResponseForService(SERVICE_UUID, CUSTOM_BUTTON_UPDATE_UUID, base64.encode(to === 0 ? "0" : buttonBehaviorMap[to].toString()));
    await sleep(20);
  }

  // SHOULD DISALLOW VALUES LESS THAN ~100 ms since that doesn't make a bunch of sense
  const updateButtonDelay = async (delay: number) => {
    await CustomOEMButtonStore.setDelay(delay);
    await connectedDevice?.writeCharacteristicWithoutResponseForService(SERVICE_UUID, CUSTOM_BUTTON_UPDATE_UUID, base64.encode(delay.toString()));
  }


  useEffect(() => {
    (async () => {
      const connect = await AutoConnectStore.get();
      if (connect === undefined) setAutoConnect(true);
      else setAutoConnect(false);

      const mac = await DeviceMACStore.getStoredMAC();
      setMAC(mac);

      if (connect === undefined && !isScanning && !isConnecting && !connectedDevice)
        await scanForDevice();
    })();
  }, [settingsOpen]);

  useEffect(() => {
    (async () => {
      console.log("hello");
      console.log(colorTheme)
      update();
    })();
  }, [appThemeOpen === false]);


  useEffect(() => {
    if (connectedDevice === null) return;
    // Check for app + or module updates

    (async () => {
      try {
        const firmware = await connectedDevice.readCharacteristicForService(SERVICE_UUID, FIRMWARE_UUID);
        if (firmware?.value) {
          const fw = base64.decode(firmware.value);

          const response = await fetch(UPDATE_URL,
            {
              method: "GET",
              headers: {
                authorization: MAC!
              },
            }
          );

          if (response.status !== 200) return;

          const json = await response.json();
          const apiVersion = json["version"] as string;

          const apiVersionParts = apiVersion.split(".");
          const firmwareParts = fw.split(".");

          let upgradeAvailable = false;
          for (let i = 0; i < 3; i++) {
            const apiPart = parseInt(apiVersionParts[i]);
            const firmwarePart = parseInt(firmwareParts[i]);
            if (apiPart > firmwarePart) {
              upgradeAvailable = true;
              break;
            }
          }

          setFirmwareVersions({
            old: fw,
            new: apiVersion
          });

          if (upgradeAvailable) {
            setUpgradeModalOpen(true);
            setPromptResponse(UpdateStates.PROMPT);
            const description = json["description"] as string | undefined;
            setFirmwareDescription(description ? description : "");
          }
        }
      } catch (err) {
        setUpgradeModalOpen(false);
        setPromptResponse(UpdateStates.CLOSED);
      }
    })();
  }, [connectedDevice !== null]);


  const downloadAndInstallFirmware = async () => {

    const response = await fetch(
      `${UPDATE_URL}/firmware`,
      {
        method: "GET",
        headers: {
          authorization: MAC!,
        },
      }
    );

    const password = generatePassword(16);

    const OTA_UUID = "a144c6b1-5e1a-4460-bb92-3674b2f51529"

    await connectedDevice?.writeCharacteristicWithoutResponseForService(
      SERVICE_UUID,
      OTA_UUID,
      base64.encode(password)
    );

    await sleep(1500);

    await WifiManager.connectToProtectedWifiSSID({
      ssid: "Wink Module: Update Access Point",
      password,
      isHidden: false,
      isWEP: false,
      timeout: 15
    });

    setWifiConnected(true);

    try {

      const blob = await response.blob();
      const blobWithType = blob.slice(0, blob.size, "application/octet-stream");

      const updateResponse = await fetch("http://module-update.local/update", {
        method: "POST",
        body: blobWithType,
        headers: {
          "Content-Length": blobWithType.size.toString(),
        }
      });


      await WifiManager.disconnect();
      await connectedDevice?.cancelConnection();

      if (updateResponse.ok) {
        setWifiConnected(false);
        setUpgradeModalOpen(false);
        setPromptResponse(UpdateStates.CLOSED);
      } else {
      }

    } catch (err) {
      alert(err);
      console.log(err);
    }

  }




  return (
    <ScrollView
      style={{
        backgroundColor: colorTheme.backgroundPrimaryColor,
        height: "100%",
        width: "100%"
      }}
      contentContainerStyle={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        rowGap: 20
      }}>

      <Text
        style={{
          color: colorTheme.headerTextColor,
          textAlign: "center",
          fontSize: 20,
          marginHorizontal: 20,
          marginTop: 45
        }}>

        {
          !connectedDevice ?
            !noDevice ?
              (isScanning ?
                "Scanning for Wink Module"
                : isConnecting ?
                  "Connecting to Wink Module... Stand by..."
                  : (autoConnect && connectedDevice) ?
                    "" : (!autoConnect && connectedDevice) ? "" :
                      "Scanner standing by... Press \"Connect\" to start scanning.")
              : autoConnect ? "No Wink Module Scanned... Trying again..."
                : "No Wink Module Scanned... Try scanning again, or restarting the app."
            : ""
        }

      </Text>

      <View
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          rowGap: 10
        }}>

        {
          !connectedDevice ?

            <Text
              style={{
                color: colorTheme.textColor,
                textAlign: "center",
                marginHorizontal: 20
              }}>
              If this takes overly long to connect, try restarting the app.{"\n"}
              If you continue to be unable to connect, try pressing the 'Reset Button' on your Wink Module, and restart the app.
            </Text>

            : <Text
              style={{
                fontSize: 30,
                fontWeight: "bold",
                color: colorTheme.headerTextColor,
                marginTop: -20
              }}>
              Connected to Wink Receiver
            </Text>
        }

        <View
          style={{
            display: "flex",
            flexDirection: "row",
            width: "90%",
            justifyContent: "flex-start",
            alignContent: "center",
            columnGap: 20
          }}>

          <OpacityButton
            buttonStyle={{}}
            text="Device Settings"
            textStyle={{
              ...styles.buttonText,
              color: colorTheme.buttonColor,
              textDecorationLine: "underline",
              fontWeight: "bold"
            }}
            onPress={() => setSettingsOpen(true)}
          />

          <OpacityButton
            buttonStyle={{}}
            text="Edit Theme"
            textStyle={{
              ...styles.buttonText,
              color: colorTheme.buttonColor,
              textDecorationLine: "underline",
              fontWeight: "bold"
            }}
            onPress={() => setAppThemeOpen(true)}
          />
        </View>
      </View>

      <View style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        rowGap: 20,
        width: "90%",
        borderRadius: 5,
        backgroundColor: colorTheme.backgroundSecondaryColor,
        padding: 30,
      }}>

        <Text
          style={{
            color: colorTheme.headerTextColor,
            textAlign: "center",
            fontSize: 24,
            fontWeight: "bold"
          }}>
          Default Commands
        </Text>

        <Text
          style={{
            color: colorTheme.textColor,
            textAlign: "center",
            fontSize: 16
          }}>
          A list of pre-loaded commands that cover a variety of movements.
        </Text>

        <OpacityButton
          buttonStyle={
            !connectedDevice ?
              {
                ...styles.buttonDisabled,
                backgroundColor: colorTheme.disabledButtonColor
              } :
              {
                ...styles.button,
                backgroundColor: colorTheme.buttonColor
              }
          }

          disabled={!connectedDevice}
          text="Go to Commands"
          textStyle={
            !connectedDevice ?
              {
                ...styles.buttonText,
                color: colorTheme.disabledButtonTextColor
              } :
              {
                ...styles.buttonText,
                color: colorTheme.buttonTextColor
              }

          }
          onPress={() => setDefaultCommandsOpen(true)}
        />
      </View>

      <View style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        rowGap: 20,
        width: "90%",
        borderRadius: 5,
        borderColor: colorTheme.backgroundSecondaryColor,
        borderWidth: 3,
        padding: 30,
      }}>
        <Text
          style={{
            color: colorTheme.headerTextColor,
            textAlign: "center",
            fontSize: 24,
            fontWeight: "bold"
          }}>
          Custom Presets
        </Text>

        <Text
          style={{
            color: colorTheme.textColor,
            textAlign: "center",
            fontSize: 16
          }}>
          If the default commands on this app aren't enough for you, try making your own sequence of headlight movements!
        </Text>

        <OpacityButton
          buttonStyle={!connectedDevice ? { ...styles.buttonDisabled, backgroundColor: colorTheme.disabledButtonColor } : { ...styles.button, backgroundColor: colorTheme.buttonColor }}
          disabled={!connectedDevice}
          text="Create a Preset Command"
          textStyle={!connectedDevice ? { ...styles.buttonText, color: colorTheme.disabledButtonTextColor } : { ...styles.buttonText, color: colorTheme.buttonTextColor }}
          onPress={() => setCreateCustomOpen(true)}
        />
        <OpacityButton
          buttonStyle={!connectedDevice ? { ...styles.buttonDisabled, backgroundColor: colorTheme.disabledButtonColor } : { ...styles.button, backgroundColor: colorTheme.buttonColor }}
          disabled={!connectedDevice}
          text="Execute a Preset"
          textStyle={!connectedDevice ? { ...styles.buttonText, color: colorTheme.disabledButtonTextColor } : { ...styles.buttonText, color: colorTheme.buttonTextColor }}
          onPress={() => setCustomPresetOpen(true)}
        />
      </View>

      {
        (connectedDevice !== null) ?
          <OpacityButton
            disabled={!connectedDevice}
            buttonStyle={{
              ...(!connectedDevice ? { ...styles.buttonDisabled, backgroundColor: colorTheme.disabledButtonColor } : { ...styles.button, backgroundColor: colorTheme.buttonColor }), marginBottom: 20
            }}
            textStyle={!connectedDevice ? { ...styles.buttonText, color: colorTheme.disabledButtonTextColor } : { ...styles.buttonText, color: colorTheme.buttonTextColor }}
            onPress={() => disconnect()}
            text="Disconnect"
          />
          // connectedDevice is null
          :
          !autoConnect ?
            <OpacityButton
              disabled={noDevice ? false : (isConnecting || isScanning)}
              buttonStyle={{ ...((noDevice ? false : (isConnecting || isScanning)) ? { ...styles.buttonDisabled, backgroundColor: colorTheme.disabledButtonColor } : { ...styles.button, backgroundColor: colorTheme.buttonColor }), marginBottom: 20 }}
              textStyle={((noDevice ? false : (isConnecting || isScanning))) ? { ...styles.buttonText, color: colorTheme.disabledButtonTextColor } : { ...styles.buttonText, color: colorTheme.buttonTextColor }}
              onPress={() => scanForDevice()}
              text="Connect"
            />
            : <></>
      }





      <DefaultCommands
        close={() => setDefaultCommandsOpen(false)}
        device={connectedDevice}
        headlightsBusy={headlightsBusy}
        leftState={leftState}
        rightState={rightState}
        visible={defaultCommandsOpen}
        sendDefaultCommand={sendDefaultCommand}
        sendSleepCommand={sendSleepCommand}
        sendSyncCommand={sendSyncSignal}
        colorTheme={colorTheme}
        key={1}
      />

      <CreateCustomCommands
        close={() => setCreateCustomOpen(false)}
        device={connectedDevice}
        visible={createCustomOpen}
        colorTheme={colorTheme}
        key={2}
      />

      <CustomCommands
        close={() => setCustomPresetOpen(false)}
        device={connectedDevice}
        headlightBusy={headlightsBusy}
        leftStatus={leftState}
        rightStatus={rightState}
        visible={customPresetOpen}
        sendDefaultCommand={sendDefaultCommand}
        colorTheme={colorTheme}
        key={3}
      />

      <Settings
        close={() => setSettingsOpen(false)}
        visible={settingsOpen}
        enterDeepSleep={enterDeepSleep}
        colorTheme={colorTheme}
        device={connectedDevice}
        updateOEMButton={updateOEMButtonPresets}
        updateButtonDelay={updateButtonDelay}
        key={4}
      />

      <AppTheme
        close={() => setAppThemeOpen(false)}
        visible={appThemeOpen}
        key={5}
      />



      {/* FIRMWARE UPGRADE SCREEN / POPUP */}
      <Modal
        visible={connectedDevice !== null && upgradeModalOpen}
        animationType="slide"
        hardwareAccelerated
        transparent
      // onRequestClose={() => setUpgradeModalOpen(false)}
      >
        {
          promptResponse === UpdateStates.PROMPT ?
            // Prompting user for download
            <View
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: "85%",
                padding: 15,
                position: "absolute",
                bottom: 60,
                elevation: 5,
                shadowColor: "black",
                rowGap: 15,
                shadowOpacity: 1,
                shadowRadius: 10,
                borderRadius: 10,
                alignSelf: "center",
                backgroundColor: colorTheme.backgroundSecondaryColor,
              }}
            >
              <Text
                style={{
                  color: colorTheme.textColor,
                  textAlign: "center",
                  fontSize: 17,
                  width: "100%",
                }}
              >
                A Wink Module Firmware update is available.{"\n"}
                Would you like to install it now?
                {firmwareVersions.old} → {firmwareVersions.new}
                {"\n"}Whats New?
                {firmwareDescription}
              </Text>
              <View style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "flex-start",
                columnGap: 25,
              }}>
                <OpacityButton
                  text="Install"
                  buttonStyle={{
                    backgroundColor: "#228B22",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 15,
                    paddingVertical: 7,
                    borderRadius: 5,
                  }}
                  textStyle={{
                    color: colorTheme.buttonTextColor,
                    fontSize: 17,
                    fontWeight: "bold",
                  }}
                  onPress={
                    async () => {
                      setUpgradeModalOpen(false);
                      setPromptResponse(UpdateStates.ACCEPTED);
                      await sleep(100);
                      setUpgradeModalOpen(true);
                      await downloadAndInstallFirmware();
                    }
                  }
                />

                <OpacityButton
                  text="Not now"
                  buttonStyle={{
                    backgroundColor: "#de142c",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 15,
                    paddingVertical: 7,
                    borderRadius: 5,
                  }}
                  textStyle={{
                    color: colorTheme.buttonTextColor,
                    fontSize: 17,
                    fontWeight: "bold",
                  }}
                  // USER DENIES FIRMWARE UPDATE
                  onPress={
                    async () => {
                      setUpgradeModalOpen(false);
                      setPromptResponse(UpdateStates.DENIED);
                      await sleep(500);
                      setUpgradeModalOpen(true);
                      setTimeout(() => {
                        setUpgradeModalOpen(false);
                        setPromptResponse(UpdateStates.CLOSED);
                      }, 5000);
                    }
                  }
                />
              </View>
            </View>
            : promptResponse === UpdateStates.DENIED ?
              // Download denied
              <View
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "85%",
                  padding: 15,
                  position: "absolute",
                  bottom: 60,
                  elevation: 5,
                  shadowColor: "black",
                  rowGap: 15,
                  shadowOpacity: 1,
                  shadowRadius: 10,
                  borderRadius: 10,
                  alignSelf: "center",
                  backgroundColor: colorTheme.backgroundSecondaryColor,
                }}
              >
                <Text
                  style={{
                    color: colorTheme.textColor,
                    textAlign: "center",
                    fontSize: 17,
                    width: "100%"
                  }}
                >
                  Consider installing the latest Wink Mod firmware to stay up to date with bug fixes.
                </Text>
              </View>


              // Download Accepted
              : <View
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(0, 0, 0, 0.3)",
                  zIndex: 1000,
                }}
              >
                <View
                  style={{
                    backgroundColor: colorTheme.backgroundPrimaryColor,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    padding: 20,
                    rowGap: 20,
                    width: "80%",
                    borderRadius: 5,
                  }}
                >
                  {
                    wifiConnected === false ?
                      <>

                        <Text
                          style={{
                            color: colorTheme.headerTextColor,
                            fontSize: 20,
                            fontWeight: "bold",
                            textAlign: "center",
                          }}
                        >

                          Connecting to Wink Module update server...
                        </Text>

                      </>
                      : <>
                        <Text
                          style={{
                            color: colorTheme.headerTextColor,
                            fontSize: 20,
                            fontWeight: "bold",
                            textAlign: "center",
                          }}
                        >
                          Wink Module update in progress...
                        </Text>

                        <Text
                          style={{
                            color: colorTheme.textColor,
                            fontSize: 16,
                            textAlign: "center"
                          }}
                        >
                          Update Status: {updatingStatus}{"\n\n"}
                          Update Progress: {updateProgress}%
                        </Text>


                        <Text
                          style={{
                            color: colorTheme.textColor,
                            fontSize: 18,
                            textAlign: "center"
                          }}
                        >
                          Please wait, this can take a minute... Please do not unplug the Module or disconnect from the device while in progress...
                        </Text>
                      </>
                  }
                </View>
              </View>
        }
      </Modal>

    </ScrollView >

  );
}

const styles = StyleSheet.create({
  text: {
    color: "white",
    fontSize: 30,
    fontWeight: "bold"
  },
  button: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#990033",
    width: 200,
    height: 50,
    borderRadius: 5,
  },
  buttonDisabled: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "grey",
    width: 200,
    height: 50,
    borderRadius: 5,
  },
  buttonText: {
    color: "white",
    fontSize: 20,
    textAlign: "center"
  }
});
