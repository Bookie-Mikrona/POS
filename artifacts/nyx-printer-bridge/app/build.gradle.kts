plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

val offlineAuthorityKeyId = providers.gradleProperty("BOOKIE_OFFLINE_AUTHORITY_KEY_ID")
    .orElse(providers.environmentVariable("BOOKIE_OFFLINE_AUTHORITY_KEY_ID"))
val offlineAuthorityPemBase64 = providers.gradleProperty("BOOKIE_OFFLINE_AUTHORITY_PUBLIC_KEY_PEM_BASE64")
    .orElse(providers.environmentVariable("BOOKIE_OFFLINE_AUTHORITY_PUBLIC_KEY_PEM_BASE64"))

android {
    namespace = "si.pos.nyxbridge"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "si.pos.nyxbridge"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        resValue("string", "bookie_offline_authority_key_id", offlineAuthorityKeyId.orNull ?: "")
        resValue("string", "bookie_offline_authority_public_key_pem_base64", offlineAuthorityPemBase64.orNull ?: "")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
        debug {
            // Brez sufiksa — paket je vedno si.pos.nyxbridge
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
        aidl = true
    }

    // Shared fiscal ledger; vendor printer code stays in this application.
    sourceSets["main"].java.srcDir("../../bookie-fiscal-android-core/src/main/kotlin")
    sourceSets["main"].assets.srcDir("../../../fiscal-service/contract")
    sourceSets["main"].assets.exclude("golden-vectors-v1.json")
    sourceSets["test"].java.srcDir("../../bookie-fiscal-android-core/src/test/kotlin")
}

tasks.configureEach {
    if (name.contains("Release", ignoreCase = true) &&
        (name.startsWith("assemble") || name.startsWith("bundle") || name.startsWith("package"))) {
        doFirst {
            require(offlineAuthorityKeyId.orNull?.isNotBlank() == true &&
                offlineAuthorityPemBase64.orNull?.isNotBlank() == true) {
                "Release requires BOOKIE_OFFLINE_AUTHORITY_KEY_ID and BOOKIE_OFFLINE_AUTHORITY_PUBLIC_KEY_PEM_BASE64"
            }
            require(offlineAuthorityKeyId.get() != "FURS-V1-GOLDEN-TEST-ONLY") {
                "Golden TEST-ONLY authority is forbidden in release"
            }
        }
    }
}

dependencies {
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    // NYX SDK nima JAR — tiskanje je izključno prek AIDL bindService
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
