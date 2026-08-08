pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
    }

    tools {
        nodejs 'nodejs-24'
    }

    environment {
        FRONT_INTERNAL_URL = 'http://bank-front:8080'
        SONARQUBE_INSTALLATION = 'sonarqube'
        SONAR_SCANNER_TOOL = 'sonar-scanner'

        NEXUS_DOCKER_REGISTRY = 'localhost:8084'
        NEXUS_DOCKER_API_URL  = 'http://host.docker.internal:8084'
        NEXUS_COSIGN_REGISTRY = 'host.docker.internal:8084'
        IMAGE_REPOSITORY      = 'localhost:8084/bank-front'

        TRIVY_IMAGE = 'aquasec/trivy:0.72.0'
        TRIVY_CACHE_VOLUME = 'trivy-cache'
        TRIVY_REPORT_SEVERITY = 'HIGH,CRITICAL'
        TRIVY_GATE_SEVERITY = 'CRITICAL'

        COSIGN_IMAGE = 'ghcr.io/sigstore/cosign/cosign:v3.0.6'
    }

    stages {
       stage('Checkout') {
            steps {
                script {
                    def scmVariables = checkout scm

                    env.GIT_COMMIT_SHA =
                        scmVariables['GIT_COMMIT'] ?: sh(
                            script: 'git rev-parse HEAD',
                            returnStdout: true
                        ).trim()

                    echo "Commit récupéré : ${env.GIT_COMMIT_SHA}"
                }
            }
        }

        stage('Preflight') {
            steps {
                sh '''
                    set -eu

                    echo "=== Node.js ==="
                    node --version

                    echo
                    echo "=== npm ==="
                    npm --version

                    echo
                    echo "=== Version Node attendue ==="
                    cat .nvmrc

                    ACTIVE_NODE="$(node --version | sed 's/^v//')"
                    EXPECTED_NODE="$(cat .nvmrc)"

                    if [ "$ACTIVE_NODE" != "$EXPECTED_NODE" ]; then
                        echo "Version Node incorrecte."
                        echo "Attendue : $EXPECTED_NODE"
                        echo "Active   : $ACTIVE_NODE"
                        exit 1
                    fi

                    echo
                    echo "=== Docker ==="
                    docker version \
                      --format 'Docker Server: {{.Server.Version}}'

                    echo
                    echo "=== Docker Compose ==="
                    docker compose version

                    echo
                    echo "=== curl ==="
                    command -v curl

                    echo
                    echo "=== Réseau Docker ==="
                    docker network inspect bank-net >/dev/null
                    echo "bank-net disponible"

                    echo
                    echo "=== Configuration Compose ==="
                    docker compose config >/dev/null
                    echo "compose.yaml valide"

                    echo
                    echo "=== Backend depuis Jenkins ==="
                    curl -fsS \
                      http://bank-api:8080/api/health
                '''
            }
        }

        stage('Version metadata') {
            steps {
                script {
                    env.APP_VERSION = sh(
                        script: '''
                            node -p "require('./package.json').version"
                        ''',
                        returnStdout: true
                    ).trim()

                    def lockVersion = sh(
                        script: '''
                            node -p "require('./package-lock.json').version"
                        ''',
                        returnStdout: true
                    ).trim()

                    def lockRootVersion = sh(
                        script: '''
                            node -p "
                                const lock = require('./package-lock.json');
                                lock.packages?.['']?.version ?? lock.version
                            "
                        ''',
                        returnStdout: true
                    ).trim()

                    def semverPattern =
                        '^(0|[1-9][0-9]*)\\.' +
                        '(0|[1-9][0-9]*)\\.' +
                        '(0|[1-9][0-9]*)' +
                        '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$'

                    if (!(env.APP_VERSION ==~ semverPattern)) {
                        error(
                            "Version SemVer invalide : ${env.APP_VERSION}"
                        )
                    }

                    if (lockVersion != env.APP_VERSION) {
                        error(
                            "package-lock.json=${lockVersion}, " +
                            "package.json=${env.APP_VERSION}"
                        )
                    }

                    if (lockRootVersion != env.APP_VERSION) {
                        error(
                            "package-lock root=${lockRootVersion}, " +
                            "package.json=${env.APP_VERSION}"
                        )
                    }

                    echo "Version validée : ${env.APP_VERSION}"

                    env.GIT_SHORT_SHA = sh(
                        script: 'git rev-parse --short=12 HEAD',
                        returnStdout: true
                    ).trim()

                    env.BUILD_DATE = sh(
                        script: "date -u +'%Y-%m-%dT%H:%M:%SZ'",
                        returnStdout: true
                    ).trim()

                    env.IMAGE_TAG =
                        "${env.APP_VERSION}" +
                        "-b${env.BUILD_NUMBER}" +
                        "-${env.GIT_SHORT_SHA}"

                    env.IMAGE_REF =
                        "${env.IMAGE_REPOSITORY}:${env.IMAGE_TAG}"
                    env.BANK_FRONT_IMAGE =env.IMAGE_REF
                    
                    env.RELEASE_GIT_TAG = sh(
                        script: """
                            git tag \
                            --points-at HEAD \
                            --list 'v${env.APP_VERSION}' |
                            head -n 1
                        """,
                        returnStdout: true
                    ).trim()

                    env.RELEASE_IMAGE_REF =
                        env.RELEASE_GIT_TAG
                            ? "${env.IMAGE_REPOSITORY}:${env.APP_VERSION}"
                            : ''

                    currentBuild.displayName =
                        "#${env.BUILD_NUMBER} ${env.IMAGE_TAG}"

                    writeFile(
                        file: 'build-metadata.properties',
                        text: """application=bank-front
                    version=${env.APP_VERSION}
                    gitCommit=${env.GIT_COMMIT_SHA}
                    gitShortSha=${env.GIT_SHORT_SHA}
                    gitTag=${env.RELEASE_GIT_TAG}
                    buildNumber=${env.BUILD_NUMBER}
                    buildDate=${env.BUILD_DATE}
                    image=${env.IMAGE_REF}
                    releaseImage=${env.RELEASE_IMAGE_REF}
                    """
                    )
                }

                sh '''
                    set -eu

                    test -s build-metadata.properties

                    echo "=== Métadonnées du build ==="
                    cat build-metadata.properties
                '''
            }
        }

        stage('Install dependencies') {
            steps {
                sh '''
                    set -eu

                    npm ci
                '''
            }
        }

        stage('Lint') {
            steps {
                timeout(
                    time: 5,
                    unit: 'MINUTES'
                ) {
                    sh '''
                        set -eu

                        echo "=== Nettoyage des artefacts précédents ==="

                        rm -rf \
                        coverage \
                        coverage-publish \
                        trivy-reports \
                        cosign-reports \
                        .cosign-bin \
                        sbom-reports \
                        hardening-reports \
                        nginx-optimization-reports \
                        dist \
                        .angular/cache

                        echo

                        echo "=== Analyse ESLint ==="

                        npm run lint:ci

                        echo
                        echo "ESLint validé"
                    '''
                }
            }
        }

       stage('Unit tests and coverage') {
            steps {
                timeout(
                    time: 5,
                    unit: 'MINUTES'
                ) {
                    sh '''
                        set -eu

                        echo "=== Tests unitaires et couverture ==="

                        rm -rf \
                        coverage \
                        coverage-publish

                        npm run test:coverage

                        echo
                        echo "=== Fichiers de couverture générés ==="

                        find coverage \
                        -maxdepth 4 \
                        -type f \
                        | sort

                        echo
                        echo "=== Recherche des rapports ==="

                        HTML_INDEX="$(
                            find coverage \
                            -maxdepth 2 \
                            -type f \
                            -name index.html \
                            -print \
                            -quit
                        )"

                        LCOV_FILE="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name lcov.info \
                            -print \
                            -quit
                        )"

                        JSON_SUMMARY="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name coverage-summary.json \
                            -print \
                            -quit
                        )"

                        COBERTURA_FILE="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name '*cobertura*.xml' \
                            -print \
                            -quit
                        )"

                        if [ -z "$HTML_INDEX" ]; then
                            echo "Rapport HTML de couverture introuvable."
                            exit 1
                        fi

                        if [ -z "$LCOV_FILE" ]; then
                            echo "Rapport LCOV introuvable."
                            exit 1
                        fi

                        if [ -z "$JSON_SUMMARY" ]; then
                            echo "Résumé JSON de couverture introuvable."
                            exit 1
                        fi

                        echo "HTML      : $HTML_INDEX"
                        echo "LCOV      : $LCOV_FILE"
                        echo "JSON      : $JSON_SUMMARY"
                        echo "Cobertura : ${COBERTURA_FILE:-non généré}"

                        echo
                        echo "=== Normalisation pour Jenkins ==="

                        REPORT_DIRECTORY="$(dirname "$HTML_INDEX")"

                        mkdir -p coverage-publish

                        cp -R \
                        "$REPORT_DIRECTORY/." \
                        coverage-publish/

                        cp \
                        "$LCOV_FILE" \
                        coverage-publish/lcov.info

                        cp \
                        "$JSON_SUMMARY" \
                        coverage-publish/coverage-summary.json

                        if [ -n "$COBERTURA_FILE" ]; then
                            cp \
                            "$COBERTURA_FILE" \
                            coverage-publish/cobertura-coverage.xml
                        fi

                        test -f coverage-publish/index.html
                        test -f coverage-publish/lcov.info
                        test -f coverage-publish/coverage-summary.json

                        echo
                        echo "Rapports de couverture validés"
                    '''
                }
            }

            post {
                always {
                    archiveArtifacts(
                        artifacts: '''
                            coverage/**/*,
                            coverage-publish/**/*
                        ''',
                        allowEmptyArchive: true,
                        fingerprint: false
                    )

                    publishHTML(
                        target: [
                            reportDir: 'coverage-publish',
                            reportFiles: 'index.html',
                            reportName: 'Couverture Angular',
                            reportTitles: 'Rapport de couverture',
                            keepAll: true,
                            alwaysLinkToLastBuild: true,
                            allowMissing: true
                        ]
                    )
                }
            }
        }

        stage('SonarQube analysis') {
            steps {
                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    script {
                        def scannerHome = tool env.SONAR_SCANNER_TOOL

                        withEnv([
                            "SONAR_SCANNER_HOME=${scannerHome}"
                        ]) {
                            withSonarQubeEnv(
                                installationName: env.SONARQUBE_INSTALLATION,
                                credentialsId: 'sonarqube-bank-front-token'
                            ) {
                                sh '''
                                    set -eu

                                    echo "=== Préparation SonarQube ==="

                                    rm -rf .scannerwork

                                    test -f sonar-project.properties
                                    test -f coverage/bank-front/lcov.info

                                    echo
                                    echo "Serveur SonarQube : $SONAR_HOST_URL"

                                    curl \
                                    -fsS \
                                    --connect-timeout 5 \
                                    --max-time 15 \
                                    "$SONAR_HOST_URL/api/system/status"

                                    echo
                                    echo
                                    echo "=== Version SonarScanner ==="

                                    "$SONAR_SCANNER_HOME/bin/sonar-scanner" \
                                    --version

                                    echo
                                    echo "=== Analyse SonarQube ==="

                                    "$SONAR_SCANNER_HOME/bin/sonar-scanner"

                                    test \
                                    -f .scannerwork/report-task.txt

                                    echo
                                    echo "Analyse SonarQube envoyée"
                                '''
                            }
                        }
                    }
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    script {
                        def qualityGate = waitForQualityGate(
                            abortPipeline: false,
                            webhookSecretId: 'sonarqube-webhook-secret'
                        )

                        echo "Quality Gate SonarQube : ${qualityGate.status}"

                        if (qualityGate.status != 'OK') {
                            error(
                                "Quality Gate SonarQube non validé : " +
                                qualityGate.status
                            )
                        }
                    }
                }
            }
        }

        stage('Build Angular') {
            steps {
                sh '''
                    set -eu

                    npm run build:prod

                    test \
                    -f dist/bank-front/browser/index.html

                    echo "Build Angular validé"
                '''

                script {
                    def gitTagJson = env.RELEASE_GIT_TAG
                        ? "\"${env.RELEASE_GIT_TAG}\""
                        : 'null'

                    writeFile(
                        file: 'dist/bank-front/browser/version.json',
                        text: """{
        "application": "bank-front",
        "version": "${env.APP_VERSION}",
        "image": "${env.IMAGE_REF}",
        "gitCommit": "${env.GIT_COMMIT_SHA}",
        "gitShortSha": "${env.GIT_SHORT_SHA}",
        "gitTag": ${gitTagJson},
        "buildNumber": ${env.BUILD_NUMBER},
        "buildDate": "${env.BUILD_DATE}"
        }
        """
                    )
                }

                sh '''
                    set -eu

                    test \
                    -f dist/bank-front/browser/version.json

                    node -e '
                        const fs = require("node:fs");

                        JSON.parse(
                            fs.readFileSync(
                                "dist/bank-front/browser/version.json",
                                "utf8"
                            )
                        );

                        console.log("version.json valide");
                    '

                    echo
                    echo "=== version.json ==="

                    cat \
                    dist/bank-front/browser/version.json

                    echo
                    echo "Build Angular versionné et validé"
                '''
            }
        }

        stage('Build image') {
            steps {
                sh '''
                    set -eu

                    echo "=== Image attendue ==="
                    echo "$IMAGE_REF"

                    echo
                    echo "=== Configuration Compose résolue ==="

                    docker compose config >/dev/null

                    RESOLVED_IMAGE="$(
                        docker compose config --images |
                        head -n 1
                    )"

                    echo "Image Compose : $RESOLVED_IMAGE"

                    if [ "$RESOLVED_IMAGE" != "$IMAGE_REF" ]; then
                        echo "Image Compose incorrecte."
                        echo "Attendue : $IMAGE_REF"
                        echo "Résolue  : $RESOLVED_IMAGE"
                        exit 1
                    fi

                    echo
                    echo "=== Construction de l’image ==="

                    docker compose build \
                    bank-front

                    docker image inspect \
                    "$IMAGE_REF" \
                    >/dev/null

                    echo
                    echo "=== Vérification des labels OCI ==="

                    IMAGE_VERSION="$(
                        docker image inspect \
                        --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' \
                        "$IMAGE_REF"
                    )"

                    IMAGE_REVISION="$(
                        docker image inspect \
                        --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
                        "$IMAGE_REF"
                    )"

                    IMAGE_CREATED="$(
                        docker image inspect \
                        --format '{{ index .Config.Labels "org.opencontainers.image.created" }}' \
                        "$IMAGE_REF"
                    )"

                    echo "Version  : $IMAGE_VERSION"
                    echo "Revision : $IMAGE_REVISION"
                    echo "Création : $IMAGE_CREATED"

                    test "$IMAGE_VERSION" = "$APP_VERSION"
                    test "$IMAGE_REVISION" = "$GIT_COMMIT_SHA"
                    test "$IMAGE_CREATED" = "$BUILD_DATE"

                    echo
                    echo "Image construite : $IMAGE_REF"
                '''
            }
        }

        stage('Container hardening checks') {
            steps {
                timeout(
                    time: 5,
                    unit: 'MINUTES'
                ) {
                    sh '''
                        set -eu

                        REPORT_DIR="hardening-reports"

                        mkdir -p "$REPORT_DIR"

                        echo "=== Vérification utilisateur Docker ==="

                        IMAGE_USER="$(
                            docker image inspect \
                            --format '{{.Config.User}}' \
                            "$IMAGE_REF"
                        )"

                        echo "Utilisateur image : $IMAGE_USER"

                        case "$IMAGE_USER" in
                            ""|0|0:0|root|root:root)
                                echo "L'image tourne avec root."
                                exit 1
                                ;;
                        esac


                        echo
                        echo "=== Vérification UID runtime ==="

                        RUNTIME_UID="$(
                            docker run \
                            --rm \
                            --entrypoint sh \
                            "$IMAGE_REF" \
                            -c 'id -u'
                        )"

                        echo "UID runtime : $RUNTIME_UID"

                        if [ "$RUNTIME_UID" = "0" ]; then
                            echo "Le processus utilise UID 0."
                            exit 1
                        fi


                        echo
                        echo "=== Test Nginx sous contraintes de sécurité ==="

                        docker run \
                        --rm \
                        --network bank-net \
                        --read-only \
                        --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777 \
                        --cap-drop ALL \
                        --security-opt no-new-privileges:true \
                        "$IMAGE_REF" \
                        nginx -t


                        printf \
                        'image=%s\\nuser=%s\\nuid=%s\\nreadOnlyTest=SUCCESS\\ncapDropTest=SUCCESS\\nnoNewPrivilegesTest=SUCCESS\\n' \
                        "$IMAGE_REF" \
                        "$IMAGE_USER" \
                        "$RUNTIME_UID" \
                        > "$REPORT_DIR/image-hardening.properties"


                        echo
                        echo "=== Image hardening validé ==="

                        cat \
                        "$REPORT_DIR/image-hardening.properties"
                    '''
                }
            }

            post {
                always {
                    archiveArtifacts(
                        artifacts: 'hardening-reports/**/*',
                        allowEmptyArchive: true,
                        fingerprint: true
                    )
                }
            }
        }

        stage('Publish image') {
            steps {
                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    withCredentials([
                        usernamePassword(
                            credentialsId: 'nexus-publisher',
                            usernameVariable: 'NEXUS_DOCKER_USERNAME',
                            passwordVariable: 'NEXUS_DOCKER_PASSWORD'
                        )
                    ]) {
                        sh '''
                            set -eu

                            export DOCKER_CONFIG="$WORKSPACE/.docker-nexus"

                            rm -rf \
                            "$DOCKER_CONFIG" \
                            published-manifest.json \
                            published-manifest.headers \
                            release-manifest.json \
                            release-manifest.headers \
                            existing-release-manifest.json \
                            existing-release-manifest.headers \
                            published-image.properties

                            mkdir -p "$DOCKER_CONFIG"

                            cleanup() {
                                rm -rf "$DOCKER_CONFIG"
                            }

                            trap cleanup EXIT HUP INT TERM

                            echo "=== Connexion au registry Nexus ==="
                            echo "Registry Docker : $NEXUS_DOCKER_REGISTRY"
                            echo "API Nexus       : $NEXUS_DOCKER_API_URL"

                            set +x

                            if ! printf '%s' "$NEXUS_DOCKER_PASSWORD" |
                                docker login \
                                "$NEXUS_DOCKER_REGISTRY" \
                                --username "$NEXUS_DOCKER_USERNAME" \
                                --password-stdin \
                                >/dev/null
                            then
                                set -x
                                echo "Échec de la connexion au registry Nexus."
                                exit 1
                            fi

                            set -x

                            echo "Connexion Nexus validée"

                            fetch_manifest_digest() {
                                IMAGE_REFERENCE="$1"
                                MANIFEST_FILE="$2"
                                HEADERS_FILE="$3"

                                case "$IMAGE_REFERENCE" in
                                    "$NEXUS_DOCKER_REGISTRY"/*)
                                        # Supprime uniquement le premier segment host:port/
                                        # Exemple :
                                        # localhost:8084/bank-front:0.1.0
                                        # devient :
                                        # bank-front:0.1.0
                                        IMAGE_WITH_TAG="${IMAGE_REFERENCE#*/}"
                                        ;;

                                    *)
                                        echo "Référence registry inattendue : $IMAGE_REFERENCE" >&2
                                        echo "Registry attendu : $NEXUS_DOCKER_REGISTRY" >&2
                                        return 1
                                        ;;
                                esac

                                REPOSITORY_NAME="${IMAGE_WITH_TAG%:*}"
                                TAG_VALUE="${IMAGE_WITH_TAG##*:}"

                                if [ -z "$REPOSITORY_NAME" ] ||
                                [ -z "$TAG_VALUE" ] ||
                                [ "$REPOSITORY_NAME" = "$IMAGE_WITH_TAG" ] ||
                                [ "$TAG_VALUE" = "$IMAGE_WITH_TAG" ]
                                then
                                    echo "Référence d’image invalide : $IMAGE_REFERENCE" >&2
                                    return 1
                                fi

                                MANIFEST_URL="${NEXUS_DOCKER_API_URL}/v2/${REPOSITORY_NAME}/manifests/${TAG_VALUE}"

                                rm -f \
                                "$MANIFEST_FILE" \
                                "$HEADERS_FILE"

                                echo "Manifest API : $MANIFEST_URL" >&2

                                set +e
                                set +x

                                HTTP_CODE="$(
                                    curl \
                                    --silent \
                                    --show-error \
                                    --connect-timeout 5 \
                                    --max-time 30 \
                                    --retry 4 \
                                    --retry-delay 1 \
                                    --retry-connrefused \
                                    --user "$NEXUS_DOCKER_USERNAME:$NEXUS_DOCKER_PASSWORD" \
                                    --header 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' \
                                    --dump-header "$HEADERS_FILE" \
                                    --output "$MANIFEST_FILE" \
                                    --write-out '%{http_code}' \
                                    "$MANIFEST_URL"
                                )"

                                CURL_STATUS="$?"

                                set -x
                                set -e

                                if [ "$CURL_STATUS" -ne 0 ]; then
                                    echo "Erreur réseau pendant la lecture du manifest." >&2
                                    return 1
                                fi

                                case "$HTTP_CODE" in
                                    200)
                                        ;;

                                    404)
                                        echo "Manifest absent : $IMAGE_REFERENCE" >&2
                                        return 44
                                        ;;

                                    *)
                                        echo "Réponse Nexus inattendue : HTTP $HTTP_CODE" >&2
                                        cat "$MANIFEST_FILE" >&2 || true
                                        return 1
                                        ;;
                                esac

                                DIGEST="$(
                                    node -e '
                                        const fs = require("node:fs");

                                        const lines = fs
                                            .readFileSync(process.argv[1], "utf8")
                                            .split(String.fromCharCode(10))
                                            .map((line) =>
                                                line.replaceAll(
                                                String.fromCharCode(13),
                                                ""
                                                )
                                            );

                                        const digestHeader = lines.find(
                                        (line) =>
                                            line
                                            .toLowerCase()
                                            .startsWith("docker-content-digest:")
                                        );

                                        if (!digestHeader) {
                                        console.error(
                                            "Header Docker-Content-Digest introuvable"
                                        );
                                        process.exit(2);
                                        }

                                        const digest = digestHeader
                                        .slice(digestHeader.indexOf(":") + 1)
                                        .trim();

                                        process.stdout.write(digest);
                                    ' "$HEADERS_FILE"
                                )"

                                if ! printf '%s' "$DIGEST" |
                                    grep -Eq '^sha256:[0-9a-f]{64}$'
                                then
                                    echo "Digest Nexus invalide : $DIGEST" >&2
                                    return 1
                                fi

                                printf '%s' "$DIGEST"
                            }

                            echo
                            echo "=== Publication du tag CI ==="
                            echo "$IMAGE_REF"

                            docker push "$IMAGE_REF"

                            echo
                            echo "=== Vérification du manifest distant ==="

                            REMOTE_DIGEST="$(
                                fetch_manifest_digest \
                                "$IMAGE_REF" \
                                published-manifest.json \
                                published-manifest.headers
                            )"

                            echo "Digest Nexus : $REMOTE_DIGEST"

                            RELEASE_DIGEST=""

                            if [ -n "${RELEASE_GIT_TAG:-}" ]; then
                                echo
                                echo "=== Publication de la release ==="
                                echo "Tag Git       : $RELEASE_GIT_TAG"
                                echo "Image release : $RELEASE_IMAGE_REF"

                                if EXISTING_RELEASE_DIGEST="$(
                                    fetch_manifest_digest \
                                    "$RELEASE_IMAGE_REF" \
                                    existing-release-manifest.json \
                                    existing-release-manifest.headers
                                )"
                                then
                                    if [ "$EXISTING_RELEASE_DIGEST" != "$REMOTE_DIGEST" ]; then
                                        echo "Conflit de release immuable."
                                        echo \
                                        "Tag          : $RELEASE_IMAGE_REF"
                                        echo \
                                        "Digest Nexus : $EXISTING_RELEASE_DIGEST"
                                        echo \
                                        "Digest build : $REMOTE_DIGEST"

                                        exit 1
                                    fi

                                    RELEASE_DIGEST="$EXISTING_RELEASE_DIGEST"

                                    echo \
                                    "La release existe déjà avec le bon digest."
                                else
                                    FETCH_STATUS="$?"

                                    if [ "$FETCH_STATUS" -ne 44 ]; then
                                        echo \
                                        "Impossible de vérifier la release existante."

                                        exit "$FETCH_STATUS"
                                    fi

                                    docker image tag \
                                    "$IMAGE_REF" \
                                    "$RELEASE_IMAGE_REF"

                                    docker push \
                                    "$RELEASE_IMAGE_REF"

                                    RELEASE_DIGEST="$(
                                        fetch_manifest_digest \
                                        "$RELEASE_IMAGE_REF" \
                                        release-manifest.json \
                                        release-manifest.headers
                                    )"

                                    if [ "$RELEASE_DIGEST" != "$REMOTE_DIGEST" ]; then
                                        echo "Digest de release incohérent."
                                        echo \
                                        "Tag CI  : $REMOTE_DIGEST"
                                        echo \
                                        "Release : $RELEASE_DIGEST"

                                        exit 1
                                    fi

                                    echo \
                                    "Release publiée : $RELEASE_IMAGE_REF"
                                fi
                            else
                                echo
                                echo "Aucun tag Git de release sur ce commit."
                            fi

                            printf \
                            'image=%s\\ndigest=%s\\nimmutableRef=%s@%s\\nreleaseImage=%s\\nreleaseDigest=%s\\n' \
                            "$IMAGE_REF" \
                            "$REMOTE_DIGEST" \
                            "$IMAGE_REPOSITORY" \
                            "$REMOTE_DIGEST" \
                            "${RELEASE_IMAGE_REF:-}" \
                            "$RELEASE_DIGEST" \
                            > published-image.properties

                            printf \
                            'digest=%s\\nimmutableRef=%s@%s\\n' \
                            "$REMOTE_DIGEST" \
                            "$IMAGE_REPOSITORY" \
                            "$REMOTE_DIGEST" \
                            >> build-metadata.properties

                            echo
                            echo "=== Image publiée ==="

                            cat published-image.properties
                        '''
                    }
                }
                script {
                    env.IMAGE_DIGEST = sh(
                        script: '''
                            set -eu

                            sed -n \
                            's/^digest=//p' \
                            published-image.properties |
                            head -n 1
                        ''',
                        returnStdout: true
                    ).trim()

                    env.IMMUTABLE_IMAGE_REF = sh(
                        script: '''
                            set -eu

                            sed -n \
                            's/^immutableRef=//p' \
                            published-image.properties |
                            head -n 1
                        ''',
                        returnStdout: true
                    ).trim()

                    def digestPattern =
                        '^sha256:[0-9a-f]{64}$'

                    if (!(env.IMAGE_DIGEST ==~ digestPattern)) {
                        error(
                            "Digest Nexus invalide : " +
                            env.IMAGE_DIGEST
                        )
                    }

                    def expectedImmutableRef =
                        "${env.IMAGE_REPOSITORY}" +
                        "@${env.IMAGE_DIGEST}"

                    if (
                        env.IMMUTABLE_IMAGE_REF !=
                        expectedImmutableRef
                    ) {
                        error(
                            "Référence immuable incohérente. " +
                            "Attendue=${expectedImmutableRef}, " +
                            "obtenue=${env.IMMUTABLE_IMAGE_REF}"
                        )
                    }

                    env.BANK_FRONT_IMAGE =
                        env.IMMUTABLE_IMAGE_REF

                    echo(
                        "Référence immuable validée : " +
                        env.IMMUTABLE_IMAGE_REF
                    )
                }
                sh '''
                    set -eu

                    echo
                    echo "=== Artefact Nexus sélectionné ==="
                    echo "Tag    : $IMAGE_REF"
                    echo "Digest : $IMAGE_DIGEST"
                    echo "Image  : $IMMUTABLE_IMAGE_REF"
                '''
            }
        }

        stage('Trivy image scan') {
            steps {
                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    withCredentials([
                        usernamePassword(
                            credentialsId: 'nexus-publisher',
                            usernameVariable: 'NEXUS_DOCKER_USERNAME',
                            passwordVariable: 'NEXUS_DOCKER_PASSWORD'
                        )
                    ]) {
                        sh '''
                            set -eu

                            REPORT_DIR="trivy-reports"

                            rm -rf \
                            "$REPORT_DIR" \
                            "$WORKSPACE/.docker-trivy"

                            mkdir -p \
                            "$REPORT_DIR" \
                            "$WORKSPACE/.docker-trivy"

                            export DOCKER_CONFIG="$WORKSPACE/.docker-trivy"

                            cleanup() {
                                rm -rf "$DOCKER_CONFIG"
                            }

                            trap cleanup EXIT HUP INT TERM

                            echo "=== Préparation Trivy ==="

                            docker volume inspect \
                            "$TRIVY_CACHE_VOLUME" \
                            >/dev/null

                            docker pull \
                            "$TRIVY_IMAGE" \
                            >/dev/null

                            echo
                            echo "=== Version Trivy ==="

                            docker run \
                            --rm \
                            -v "$TRIVY_CACHE_VOLUME:/root/.cache" \
                            "$TRIVY_IMAGE" \
                            --version

                            echo
                            echo "=== Image immuable à scanner ==="

                            echo "$IMMUTABLE_IMAGE_REF"

                            EXPECTED_REF="${IMAGE_REPOSITORY}@${IMAGE_DIGEST}"

                            if [ "$IMMUTABLE_IMAGE_REF" != "$EXPECTED_REF" ]; then
                                echo "Référence immuable incohérente."
                                echo "Attendue : $EXPECTED_REF"
                                echo "Obtenue  : $IMMUTABLE_IMAGE_REF"
                                exit 1
                            fi

                            echo
                            echo "=== Authentification Nexus ==="

                            set +x

                            if ! printf '%s' "$NEXUS_DOCKER_PASSWORD" |
                                docker login \
                                "$NEXUS_DOCKER_REGISTRY" \
                                --username "$NEXUS_DOCKER_USERNAME" \
                                --password-stdin \
                                >/dev/null
                            then
                                set -x
                                echo "Connexion Nexus impossible."
                                exit 1
                            fi

                            set -x

                            echo "Connexion Nexus validée"

                            echo
                            echo "=== Pull de l’image par digest ==="

                            docker pull \
                            "$IMMUTABLE_IMAGE_REF"

                            docker image inspect \
                            "$IMMUTABLE_IMAGE_REF" \
                            >/dev/null

                            echo
                            echo "=== Vérification du RepoDigest ==="

                            REPO_DIGESTS="$(
                                docker image inspect \
                                --format '{{range .RepoDigests}}{{println .}}{{end}}' \
                                "$IMMUTABLE_IMAGE_REF"
                            )"

                            printf '%s\\n' "$REPO_DIGESTS"

                            if ! printf '%s\\n' "$REPO_DIGESTS" |
                                grep \
                                -Fqx \
                                "$IMMUTABLE_IMAGE_REF"
                            then
                                echo "Le digest attendu n’est pas présent localement."
                                echo "Attendu : $IMMUTABLE_IMAGE_REF"
                                exit 1
                            fi

                            echo
                            echo "=== Rapport JSON HIGH + CRITICAL ==="

                            docker run \
                            --rm \
                            -v /var/run/docker.sock:/var/run/docker.sock \
                            -v "$TRIVY_CACHE_VOLUME:/root/.cache" \
                            "$TRIVY_IMAGE" \
                            image \
                            --image-src docker \
                            --scanners vuln \
                            --severity "$TRIVY_REPORT_SEVERITY" \
                            --skip-db-update \
                            --skip-java-db-update \
                            --offline-scan \
                            --skip-version-check \
                            --disable-telemetry \
                            --no-progress \
                            --exit-code 0 \
                            --format json \
                            "$IMMUTABLE_IMAGE_REF" \
                            > "$REPORT_DIR/image.json"

                            test \
                            -s "$REPORT_DIR/image.json"

                            echo
                            echo "=== Rapport HTML HIGH + CRITICAL ==="

                            docker run \
                            --rm \
                            -v /var/run/docker.sock:/var/run/docker.sock \
                            -v "$TRIVY_CACHE_VOLUME:/root/.cache" \
                            "$TRIVY_IMAGE" \
                            image \
                            --image-src docker \
                            --scanners vuln \
                            --severity "$TRIVY_REPORT_SEVERITY" \
                            --skip-db-update \
                            --skip-java-db-update \
                            --offline-scan \
                            --skip-version-check \
                            --disable-telemetry \
                            --no-progress \
                            --exit-code 0 \
                            --format template \
                            --template "@/contrib/html.tpl" \
                            "$IMMUTABLE_IMAGE_REF" \
                            > "$REPORT_DIR/image.html"

                            test \
                            -s "$REPORT_DIR/image.html"

                            echo
                            echo "=== Résumé Trivy ==="

                            node -e '
                                const fs = require("node:fs");

                                const report = JSON.parse(
                                    fs.readFileSync(
                                        "trivy-reports/image.json",
                                        "utf8"
                                    )
                                );

                                const vulnerabilities =
                                    (report.Results || [])
                                    .flatMap(
                                        (result) =>
                                            result.Vulnerabilities || []
                                    );

                                const high = vulnerabilities.filter(
                                    (vulnerability) =>
                                        vulnerability.Severity === "HIGH"
                                ).length;

                                const critical = vulnerabilities.filter(
                                    (vulnerability) =>
                                        vulnerability.Severity === "CRITICAL"
                                ).length;

                                console.log("HIGH     : " + high);
                                console.log("CRITICAL : " + critical);

                                fs.writeFileSync(
                                    "trivy-reports/summary.properties",
                                    "high=" + high + "\\n" +
                                    "critical=" + critical + "\\n",
                                    "utf8"
                                );
                            '

                            cat \
                            "$REPORT_DIR/summary.properties"

                            echo
                            echo "=== Security Gate Trivy ==="
                            echo \
                            "Politique : vulnérabilités $TRIVY_GATE_SEVERITY corrigibles"

                            set +e

                            docker run \
                            --rm \
                            -v /var/run/docker.sock:/var/run/docker.sock \
                            -v "$TRIVY_CACHE_VOLUME:/root/.cache" \
                            "$TRIVY_IMAGE" \
                            image \
                            --image-src docker \
                            --scanners vuln \
                            --severity "$TRIVY_GATE_SEVERITY" \
                            --ignore-unfixed \
                            --skip-db-update \
                            --skip-java-db-update \
                            --offline-scan \
                            --skip-version-check \
                            --disable-telemetry \
                            --no-progress \
                            --exit-code 1 \
                            --format table \
                            "$IMMUTABLE_IMAGE_REF" \
                            > "$REPORT_DIR/gate.txt"

                            TRIVY_GATE_STATUS="$?"

                            set -e

                            echo
                            cat "$REPORT_DIR/gate.txt"

                            echo

                            if [ "$TRIVY_GATE_STATUS" -ne 0 ]; then
                                echo "SECURITY GATE TRIVY : REFUSÉ"
                                echo
                                echo \
                                "Au moins une vulnérabilité $TRIVY_GATE_SEVERITY corrigible a été détectée."
                                echo
                                echo \
                                "Le déploiement de cette image est interdit."

                                exit 1
                            fi

                            echo "SECURITY GATE TRIVY : OK"
                            echo
                            echo "Image autorisée :"
                            echo "$IMMUTABLE_IMAGE_REF"
                        '''
                    }
                }
            }

            post {
                always {
                    archiveArtifacts(
                        artifacts: 'trivy-reports/**/*',
                        allowEmptyArchive: true,
                        fingerprint: true
                    )

                    publishHTML(
                        target: [
                            reportDir: 'trivy-reports',
                            reportFiles: 'image.html',
                            reportName: 'Trivy - Image Frontend',
                            reportTitles: 'Rapport de vulnérabilités Trivy',
                            keepAll: true,
                            alwaysLinkToLastBuild: true,
                            allowMissing: true
                        ]
                    )
                }
            }
        }

        stage('Generate SBOM') {
            steps {
                timeout(
                    time: 5,
                    unit: 'MINUTES'
                ) {
                    sh '''
                        set -eu

                        SBOM_DIR="sbom-reports"
                        SBOM_FILE="$SBOM_DIR/bank-front.cdx.json"

                        rm -rf "$SBOM_DIR"
                        mkdir -p "$SBOM_DIR"

                        echo "=== Génération du SBOM ==="

                        echo "Image :"
                        echo "$IMMUTABLE_IMAGE_REF"

                        echo
                        echo "Digest :"
                        echo "$IMAGE_DIGEST"

                        EXPECTED_REF="${IMAGE_REPOSITORY}@${IMAGE_DIGEST}"

                        if [ "$IMMUTABLE_IMAGE_REF" != "$EXPECTED_REF" ]; then
                            echo "Référence immuable incohérente."
                            echo "Attendue : $EXPECTED_REF"
                            echo "Obtenue  : $IMMUTABLE_IMAGE_REF"
                            exit 1
                        fi

                        echo
                        echo "=== Vérification de l’image locale ==="

                        docker image inspect \
                        "$IMMUTABLE_IMAGE_REF" \
                        >/dev/null

                        REPO_DIGESTS="$(
                            docker image inspect \
                            --format '{{range .RepoDigests}}{{println .}}{{end}}' \
                            "$IMMUTABLE_IMAGE_REF"
                        )"

                        printf '%s\\n' "$REPO_DIGESTS"

                        if ! printf '%s\\n' "$REPO_DIGESTS" |
                            grep \
                            -Fqx \
                            "$IMMUTABLE_IMAGE_REF"
                        then
                            echo "L’image locale ne correspond pas au digest attendu."
                            exit 1
                        fi

                        echo
                        echo "=== Trivy → CycloneDX ==="

                        docker run \
                        --rm \
                        -v /var/run/docker.sock:/var/run/docker.sock \
                        -v "$TRIVY_CACHE_VOLUME:/root/.cache" \
                        "$TRIVY_IMAGE" \
                        image \
                        --image-src docker \
                        --format cyclonedx \
                        --skip-version-check \
                        --disable-telemetry \
                        --no-progress \
                        "$IMMUTABLE_IMAGE_REF" \
                        > "$SBOM_FILE"

                        test -s "$SBOM_FILE"

                        echo
                        echo "SBOM généré : $SBOM_FILE"

                        echo
                        echo "=== Validation CycloneDX ==="

                        node -e '
                            const fs = require("node:fs");
                            const crypto = require("node:crypto");

                            const file =
                            "sbom-reports/bank-front.cdx.json";

                            const raw =
                            fs.readFileSync(file, "utf8");

                            const sbom =
                            JSON.parse(raw);

                            if (sbom.bomFormat !== "CycloneDX") {
                                throw new Error(
                                "Le document généré n’est pas un SBOM CycloneDX"
                                );
                            }

                            if (!sbom.specVersion) {
                                throw new Error(
                                "specVersion CycloneDX absente"
                                );
                            }

                            if (!sbom.serialNumber) {
                                throw new Error(
                                "serialNumber CycloneDX absent"
                                );
                            }

                            if (!sbom.metadata?.component) {
                                throw new Error(
                                "Composant principal du SBOM absent"
                                );
                            }

                            const components =
                            Array.isArray(sbom.components)
                                ? sbom.components
                                : [];

                            const sha256 =
                            crypto
                                .createHash("sha256")
                                .update(raw)
                                .digest("hex");

                            const nl =
                            String.fromCharCode(10);

                            const summary = [
                            `bomFormat=${sbom.bomFormat}`,
                            `specVersion=${sbom.specVersion}`,
                            `serialNumber=${sbom.serialNumber}`,
                            `components=${components.length}`,
                            `sbomSha256=${sha256}`
                            ].join(nl) + nl;

                            fs.writeFileSync(
                            "sbom-reports/summary.properties",
                            summary,
                            "utf8"
                            );

                            fs.writeFileSync(
                            "sbom-reports/sbom.sha256",
                            sha256 +
                                "  bank-front.cdx.json" +
                                nl,
                            "utf8"
                            );

                            console.log(
                            `Format       : ${sbom.bomFormat}`
                            );

                            console.log(
                            `Spec         : ${sbom.specVersion}`
                            );

                            console.log(
                            `Composants   : ${components.length}`
                            );

                            console.log(
                            `SHA-256 SBOM : ${sha256}`
                            );
                        '

                        echo
                        echo "=== Vérification du digest dans le SBOM ==="

                        if ! grep \
                            -Fq \
                            "$IMAGE_DIGEST" \
                            "$SBOM_FILE"
                        then
                            echo "Le digest de l’image n’apparaît pas dans le SBOM."
                            echo "Digest attendu : $IMAGE_DIGEST"
                            exit 1
                        fi

                        echo "Digest de l’image retrouvé dans le SBOM."

                        echo
                        echo "=== Provenance SBOM ==="

                        printf \
                        'application=%s\\nversion=%s\\ngitCommit=%s\\nbuildNumber=%s\\nimageTag=%s\\nimageDigest=%s\\nimmutableRef=%s\\nsbom=%s\\n' \
                        "bank-front" \
                        "$APP_VERSION" \
                        "$GIT_COMMIT_SHA" \
                        "$BUILD_NUMBER" \
                        "$IMAGE_REF" \
                        "$IMAGE_DIGEST" \
                        "$IMMUTABLE_IMAGE_REF" \
                        "$SBOM_FILE" \
                        > "$SBOM_DIR/provenance.properties"

                        cat \
                        "$SBOM_DIR/summary.properties"

                        echo

                        cat \
                        "$SBOM_DIR/provenance.properties"

                        echo
                        echo "SBOM CycloneDX validé."
                    '''
                }
            }

            post {
                always {
                    archiveArtifacts(
                        artifacts: 'sbom-reports/**/*',
                        allowEmptyArchive: true,
                        fingerprint: true
                    )
                }
            }
        }

        stage('Cosign sign and verify') {
            steps {
                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    withCredentials([
                        file(
                            credentialsId: 'cosign-bank-front-private-key',
                            variable: 'COSIGN_PRIVATE_KEY'
                        ),
                        string(
                            credentialsId: 'cosign-bank-front-password',
                            variable: 'COSIGN_PASSWORD'
                        ),
                        usernamePassword(
                            credentialsId: 'nexus-publisher',
                            usernameVariable: 'NEXUS_DOCKER_USERNAME',
                            passwordVariable: 'NEXUS_DOCKER_PASSWORD'
                        )
                    ]) {
                        sh '''
                            set -eu

                            COSIGN_BIN_DIR="$WORKSPACE/.cosign-bin"
                            COSIGN_BIN="$COSIGN_BIN_DIR/cosign"
                            REPORT_DIR="cosign-reports"

                            rm -rf \
                            "$COSIGN_BIN_DIR" \
                            "$REPORT_DIR"

                            mkdir -p \
                            "$COSIGN_BIN_DIR" \
                            "$REPORT_DIR"

                            echo "=== Préflight Cosign ==="

                            test -s "$COSIGN_PRIVATE_KEY"
                            test -s security/cosign.pub
                            test -s sbom-reports/summary.properties
                            test -s sbom-reports/bank-front.cdx.json

                            echo
                            echo "=== Récupération du SHA-256 du SBOM ==="

                            SBOM_SHA256="$(
                                sed -n \
                                's/^sbomSha256=//p' \
                                sbom-reports/summary.properties |
                                head -n 1
                            )"

                            if ! printf '%s' "$SBOM_SHA256" |
                                grep -Eq '^[0-9a-f]{64}$'
                            then
                                echo "SHA-256 du SBOM invalide."
                                echo "Valeur : $SBOM_SHA256"
                                exit 1
                            fi

                            echo "SBOM SHA-256 : $SBOM_SHA256"

                            echo
                            echo "=== Construction de la référence Cosign ==="

                            case "$IMMUTABLE_IMAGE_REF" in
                                "$NEXUS_DOCKER_REGISTRY"/*)
                                    IMAGE_PATH_AND_DIGEST="${IMMUTABLE_IMAGE_REF#*/}";;

                                *)
                                    echo "Référence immuable Nexus inattendue."
                                    echo "Image : $IMMUTABLE_IMAGE_REF"
                                    exit 1
                                    ;;
                            esac

                            COSIGN_IMAGE_REF="${NEXUS_COSIGN_REGISTRY}/${IMAGE_PATH_AND_DIGEST}"

                            echo "Référence canonique : $IMMUTABLE_IMAGE_REF"
                            echo "Référence Cosign    : $COSIGN_IMAGE_REF"

                            if ! printf '%s' "$COSIGN_IMAGE_REF" |
                                grep -Fq "@$IMAGE_DIGEST"
                            then
                                echo "Le digest Cosign ne correspond pas à IMAGE_DIGEST."
                                exit 1
                            fi

                            echo
                            echo "=== Installation temporaire de Cosign ==="

                            docker pull \
                            "$COSIGN_IMAGE" \
                            >/dev/null

                            COSIGN_SOURCE_CONTAINER="$(
                                docker create \
                                "$COSIGN_IMAGE"
                            )"

                            cleanup() {
                                if [ -n "${COSIGN_SOURCE_CONTAINER:-}" ]; then
                                    docker rm \
                                    -f \
                                    "$COSIGN_SOURCE_CONTAINER" \
                                    >/dev/null \
                                    2>&1 ||
                                    true
                                fi

                                rm -rf "$COSIGN_BIN_DIR"
                            }

                            trap cleanup EXIT HUP INT TERM

                            docker cp \
                            "$COSIGN_SOURCE_CONTAINER:/ko-app/cosign" \
                            "$COSIGN_BIN"

                            docker rm \
                            "$COSIGN_SOURCE_CONTAINER" \
                            >/dev/null

                            COSIGN_SOURCE_CONTAINER=""

                            chmod 0700 \
                            "$COSIGN_BIN"

                            echo
                            echo "=== Version Cosign ==="

                            "$COSIGN_BIN" \
                            version \
                            | tee "$REPORT_DIR/version.txt"

                            echo
                            echo "=== Signature de l'image ==="

                            set +x

                            if ! "$COSIGN_BIN" sign \
                                --key "$COSIGN_PRIVATE_KEY" \
                                --bundle "$REPORT_DIR/image.sigstore.json" \
                                --yes \
                                --allow-http-registry \
                                --tlog-upload=false \
                                --use-signing-config=false \
                                --registry-username "$NEXUS_DOCKER_USERNAME" \
                                --registry-password "$NEXUS_DOCKER_PASSWORD" \
                                -a "application=bank-front" \
                                -a "version=$APP_VERSION" \
                                -a "gitCommit=$GIT_COMMIT_SHA" \
                                -a "buildNumber=$BUILD_NUMBER" \
                                -a "canonicalImage=$IMMUTABLE_IMAGE_REF" \
                                -a "sbomSha256=$SBOM_SHA256" \
                                "$COSIGN_IMAGE_REF"
                            then
                                set -x
                                echo "Échec de la signature Cosign."
                                exit 1
                            fi

                            set -x

                            test -s \
                            "$REPORT_DIR/image.sigstore.json"

                            echo
                            echo "Image signée avec succès."

                            echo
                            echo "=== Vérification cryptographique ==="

                            set +x

                            if ! "$COSIGN_BIN" verify \
                                --key security/cosign.pub \
                                --allow-http-registry \
                                --insecure-ignore-tlog \
                                --registry-username "$NEXUS_DOCKER_USERNAME" \
                                --registry-password "$NEXUS_DOCKER_PASSWORD" \
                                -a "application=bank-front" \
                                -a "version=$APP_VERSION" \
                                -a "gitCommit=$GIT_COMMIT_SHA" \
                                -a "buildNumber=$BUILD_NUMBER" \
                                -a "canonicalImage=$IMMUTABLE_IMAGE_REF" \
                                -a "sbomSha256=$SBOM_SHA256" \
                                --output json \
                                "$COSIGN_IMAGE_REF" \
                                > "$REPORT_DIR/verification.json"
                            then
                                set -x
                                echo "Vérification Cosign refusée."
                                exit 1
                            fi

                            set -x

                            test -s \
                            "$REPORT_DIR/verification.json"

                            echo
                            echo "=== Validation du résultat Cosign ==="

                            node -e '
                                const fs = require("node:fs");

                                JSON.parse(
                                    fs.readFileSync(
                                        "cosign-reports/verification.json",
                                        "utf8"
                                    )
                                );

                                console.log(
                                    "verification.json valide"
                                );
                            '

                            if ! grep \
                                -Fq \
                                "$IMAGE_DIGEST" \
                                "$REPORT_DIR/verification.json"
                            then
                                echo "Digest absent du résultat Cosign."
                                exit 1
                            fi

                            if ! grep \
                                -Fq \
                                "$SBOM_SHA256" \
                                "$REPORT_DIR/verification.json"
                            then
                                echo "SHA-256 SBOM absent de la signature."
                                exit 1
                            fi

                            if ! grep \
                                -Fq \
                                "$GIT_COMMIT_SHA" \
                                "$REPORT_DIR/verification.json"
                            then
                                echo "Commit Git absent de la signature."
                                exit 1
                            fi

                            echo
                            echo "=== Métadonnées de signature ==="

                            PUBLIC_KEY_SHA256="$(
                                sha256sum \
                                security/cosign.pub |
                                awk '{print $1}'
                            )"

                            printf \
                            'application=%s\\nversion=%s\\nbuildNumber=%s\\ngitCommit=%s\\ncanonicalImage=%s\\ncosignImage=%s\\nimageDigest=%s\\nsbomSha256=%s\\npublicKeySha256=%s\\n' \
                            "bank-front" \
                            "$APP_VERSION" \
                            "$BUILD_NUMBER" \
                            "$GIT_COMMIT_SHA" \
                            "$IMMUTABLE_IMAGE_REF" \
                            "$COSIGN_IMAGE_REF" \
                            "$IMAGE_DIGEST" \
                            "$SBOM_SHA256" \
                            "$PUBLIC_KEY_SHA256" \
                            > "$REPORT_DIR/signature.properties"

                            cat \
                            "$REPORT_DIR/signature.properties"

                            echo
                            echo "=== COSIGN SECURITY GATE ==="
                            echo "Signature valide."
                            echo "Digest valide."
                            echo "Commit Git valide."
                            echo "SBOM lié cryptographiquement."
                            echo
                            echo "Image autorisée pour déploiement :"
                            echo "$IMMUTABLE_IMAGE_REF"
                        '''
                    }
                }
            }

            post {
                always {
                    archiveArtifacts(
                        artifacts: 'cosign-reports/**/*',
                        allowEmptyArchive: true,
                        fingerprint: true
                    )
                }
            }
        }

        stage('Deploy by digest') {
            steps {
                script {
                    if (!env.IMAGE_DIGEST?.trim()) {
                        error(
                            'IMAGE_DIGEST est absent après la publication Nexus.'
                        )
                    }

                    if (!env.IMMUTABLE_IMAGE_REF?.trim()) {
                        error(
                            'IMMUTABLE_IMAGE_REF est absent après la publication Nexus.'
                        )
                    }
                }

                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    withCredentials([
                        usernamePassword(
                            credentialsId: 'nexus-publisher',
                            usernameVariable: 'NEXUS_DOCKER_USERNAME',
                            passwordVariable: 'NEXUS_DOCKER_PASSWORD'
                        )
                    ]) {
                        sh '''
                            set -eu

                            export DOCKER_CONFIG="$WORKSPACE/.docker-deploy"

                            rm -rf \
                            "$DOCKER_CONFIG" \
                            deployed-image.properties

                            mkdir -p "$DOCKER_CONFIG"

                            cleanup() {
                                rm -rf "$DOCKER_CONFIG"
                            }

                            trap cleanup EXIT HUP INT TERM

                            EXPECTED_IMMUTABLE_REF="${IMAGE_REPOSITORY}@${IMAGE_DIGEST}"

                            if [ "$IMMUTABLE_IMAGE_REF" != "$EXPECTED_IMMUTABLE_REF" ]; then
                                echo "Référence immuable invalide."
                                echo "Attendue : $EXPECTED_IMMUTABLE_REF"
                                echo "Obtenue  : $IMMUTABLE_IMAGE_REF"
                                exit 1
                            fi

                            echo "=== Déploiement Nexus par digest ==="
                            echo "Tag source : $IMAGE_REF"
                            echo "Digest     : $IMAGE_DIGEST"
                            echo "Référence  : $IMMUTABLE_IMAGE_REF"

                            echo
                            echo "=== Connexion temporaire à Nexus ==="

                            set +x

                            if ! printf '%s' "$NEXUS_DOCKER_PASSWORD" |
                                docker login \
                                "$NEXUS_DOCKER_REGISTRY" \
                                --username "$NEXUS_DOCKER_USERNAME" \
                                --password-stdin \
                                >/dev/null
                            then
                                set -x
                                echo "Connexion Nexus impossible."
                                exit 1
                            fi

                            set -x

                            echo "Connexion Nexus validée"

                            echo
                            echo "=== Suppression des références locales du build ==="

                            docker image rm \
                            "$IMAGE_REF" \
                            >/dev/null \
                            2>&1 ||
                            true

                            docker image rm \
                            "$IMMUTABLE_IMAGE_REF" \
                            >/dev/null \
                            2>&1 ||
                            true

                            echo
                            echo "=== Pull explicite par digest ==="

                            docker pull \
                            "$IMMUTABLE_IMAGE_REF"

                            docker image inspect \
                            "$IMMUTABLE_IMAGE_REF" \
                            >/dev/null

                            echo
                            echo "=== Vérification du RepoDigest local ==="

                            PULLED_REPO_DIGESTS="$(
                                docker image inspect \
                                --format '{{range .RepoDigests}}{{println .}}{{end}}' \
                                "$IMMUTABLE_IMAGE_REF"
                            )"

                            printf '%s\n' \
                            "$PULLED_REPO_DIGESTS"

                            if ! printf '%s\n' "$PULLED_REPO_DIGESTS" |
                                grep \
                                -Fqx \
                                "$IMMUTABLE_IMAGE_REF"
                            then
                                echo "Le digest Nexus attendu n’est pas présent localement."
                                echo "Attendu : $IMMUTABLE_IMAGE_REF"
                                exit 1
                            fi

                            echo
                            echo "=== Configuration Compose résolue ==="

                            export BANK_FRONT_IMAGE="$IMMUTABLE_IMAGE_REF"

                            docker compose config \
                            >/dev/null

                            RESOLVED_IMAGE="$(
                                docker compose config \
                                --images |
                                head -n 1
                            )"

                            echo "Image Compose : $RESOLVED_IMAGE"

                            if [ "$RESOLVED_IMAGE" != "$IMMUTABLE_IMAGE_REF" ]; then
                                echo "Compose ne référence pas le digest attendu."
                                echo "Attendue : $IMMUTABLE_IMAGE_REF"
                                echo "Résolue  : $RESOLVED_IMAGE"
                                exit 1
                            fi

                            echo
                            echo "=== Recréation du conteneur ==="

                            docker compose up \
                            -d \
                            --no-build \
                            --pull never \
                            --force-recreate \
                            bank-front

                            docker compose ps \
                            bank-front

                            CONTAINER_ID="$(
                                docker compose ps \
                                -q \
                                bank-front
                            )"

                            if [ -z "$CONTAINER_ID" ]; then
                                echo "Conteneur bank-front introuvable."
                                exit 1
                            fi

                            echo
                            echo "=== Vérification du conteneur ==="

                            CONTAINER_IMAGE_REFERENCE="$(
                                docker inspect \
                                --format '{{.Config.Image}}' \
                                "$CONTAINER_ID"
                            )"

                            RUNNING_IMAGE_ID="$(
                                docker inspect \
                                --format '{{.Image}}' \
                                "$CONTAINER_ID"
                            )"

                            EXPECTED_IMAGE_ID="$(
                                docker image inspect \
                                --format '{{.Id}}' \
                                "$IMMUTABLE_IMAGE_REF"
                            )"

                            echo "Référence configurée : $CONTAINER_IMAGE_REFERENCE"
                            echo "Image ID active      : $RUNNING_IMAGE_ID"
                            echo "Image ID attendue    : $EXPECTED_IMAGE_ID"

                            if [ "$CONTAINER_IMAGE_REFERENCE" != "$IMMUTABLE_IMAGE_REF" ]; then
                                echo "Le conteneur n’a pas été créé avec le digest attendu."
                                echo "Attendu : $IMMUTABLE_IMAGE_REF"
                                echo "Actif   : $CONTAINER_IMAGE_REFERENCE"
                                exit 1
                            fi

                            if [ "$RUNNING_IMAGE_ID" != "$EXPECTED_IMAGE_ID" ]; then
                                echo "Le contenu exécuté ne correspond pas à l’image tirée."
                                echo "Actif   : $RUNNING_IMAGE_ID"
                                echo "Attendu : $EXPECTED_IMAGE_ID"
                                exit 1
                            fi

                            printf \
                            'sourceTag=%s\ndigest=%s\nimmutableRef=%s\ncontainerId=%s\ncontainerImageRef=%s\nrunningImageId=%s\nbuildNumber=%s\ngitCommit=%s\n' \
                            "$IMAGE_REF" \
                            "$IMAGE_DIGEST" \
                            "$IMMUTABLE_IMAGE_REF" \
                            "$CONTAINER_ID" \
                            "$CONTAINER_IMAGE_REFERENCE" \
                            "$RUNNING_IMAGE_ID" \
                            "$BUILD_NUMBER" \
                            "$GIT_COMMIT_SHA" \
                            > deployed-image.properties

                            echo
                            echo "=== Preuve de déploiement immuable ==="

                            cat deployed-image.properties

                            echo
                            echo "Image déployée par digest :"
                            echo "$IMMUTABLE_IMAGE_REF"
                        '''
                    }
                }
            }
        }

        stage('Runtime hardening checks') {
            steps {
                sh '''
                    set -eu

                    REPORT_DIR="hardening-reports"

                    mkdir -p "$REPORT_DIR"

                    CONTAINER_ID="$(
                        docker compose ps \
                        -q \
                        bank-front
                    )"

                    if [ -z "$CONTAINER_ID" ]; then
                        echo "Conteneur bank-front introuvable."
                        exit 1
                    fi


                    echo "=== Runtime hardening ==="

                    READ_ONLY="$(
                        docker inspect \
                        --format '{{.HostConfig.ReadonlyRootfs}}' \
                        "$CONTAINER_ID"
                    )"

                    PIDS_LIMIT="$(
                        docker inspect \
                        --format '{{.HostConfig.PidsLimit}}' \
                        "$CONTAINER_ID"
                    )"

                    MEMORY_LIMIT="$(
                        docker inspect \
                        --format '{{.HostConfig.Memory}}' \
                        "$CONTAINER_ID"
                    )"

                    CPU_LIMIT="$(
                        docker inspect \
                        --format '{{.HostConfig.NanoCpus}}' \
                        "$CONTAINER_ID"
                    )"


                    echo "ReadonlyRootfs : $READ_ONLY"
                    echo "PidsLimit      : $PIDS_LIMIT"
                    echo "Memory         : $MEMORY_LIMIT"
                    echo "NanoCpus       : $CPU_LIMIT"


                    if [ "$READ_ONLY" != "true" ]; then
                        echo "Root filesystem non read-only."
                        exit 1
                    fi


                    if [ "$PIDS_LIMIT" != "64" ]; then
                        echo "PidsLimit inattendu."
                        exit 1
                    fi


                    if [ "$MEMORY_LIMIT" != "134217728" ]; then
                        echo "Limite mémoire inattendue."
                        exit 1
                    fi


                    if [ "$CPU_LIMIT" != "500000000" ]; then
                        echo "Limite CPU inattendue."
                        exit 1
                    fi


                    echo
                    echo "=== Capabilities ==="

                    docker inspect \
                    --format '{{range .HostConfig.CapDrop}}{{println .}}{{end}}' \
                    "$CONTAINER_ID" \
                    | tee "$REPORT_DIR/cap-drop.txt"

                    grep \
                    -Fqx \
                    "ALL" \
                    "$REPORT_DIR/cap-drop.txt"


                    echo
                    echo "=== no-new-privileges ==="

                    docker inspect \
                    --format '{{range .HostConfig.SecurityOpt}}{{println .}}{{end}}' \
                    "$CONTAINER_ID" \
                    | tee "$REPORT_DIR/security-options.txt"

                    grep \
                    -Fq \
                    "no-new-privileges" \
                    "$REPORT_DIR/security-options.txt"


                    echo
                    echo "=== UID du processus ==="

                    RUNTIME_UID="$(
                        docker exec \
                        "$CONTAINER_ID" \
                        id -u
                    )"

                    echo "UID : $RUNTIME_UID"

                    if [ "$RUNTIME_UID" = "0" ]; then
                        echo "Le conteneur tourne en root."
                        exit 1
                    fi


                    echo
                    echo "=== CapEff kernel ==="

                    CAP_EFFECTIVE="$(
                        docker exec \
                        "$CONTAINER_ID" \
                        sh -c \
                        'awk "/^CapEff:/{print \\$2}" /proc/1/status'
                    )"

                    echo "CapEff : $CAP_EFFECTIVE"

                    if [ "$CAP_EFFECTIVE" != "0000000000000000" ]; then
                        echo "Des capabilities sont toujours actives."
                        exit 1
                    fi


                    echo
                    echo "=== NoNewPrivs kernel ==="

                    NO_NEW_PRIVS="$(
                        docker exec \
                        "$CONTAINER_ID" \
                        sh -c \
                        'awk "/^NoNewPrivs:/{print \\$2}" /proc/1/status'
                    )"

                    echo "NoNewPrivs : $NO_NEW_PRIVS"

                    if [ "$NO_NEW_PRIVS" != "1" ]; then
                        echo "no-new-privileges n'est pas actif."
                        exit 1
                    fi


                    echo
                    echo "=== Test filesystem read-only ==="

                    if docker exec \
                        "$CONTAINER_ID" \
                        sh -c \
                        'touch /etc/hardening-write-test' \
                        2>/dev/null
                    then
                        echo "ERREUR : écriture possible dans /etc."
                        exit 1
                    fi

                    echo "/etc est bien read-only."


                    echo
                    echo "=== Test tmpfs ==="

                    docker exec \
                    "$CONTAINER_ID" \
                    sh -c \
                    'touch /tmp/hardening-test && rm /tmp/hardening-test'

                    echo "/tmp reste writable."


                    echo
                    echo "=== Headers HTTP de sécurité ==="

                    curl \
                    -sS \
                    -D "$REPORT_DIR/headers.txt" \
                    -o /dev/null \
                    "$FRONT_INTERNAL_URL/"

                    cat \
                    "$REPORT_DIR/headers.txt"


                    grep \
                    -qi \
                    '^X-Content-Type-Options: nosniff' \
                    "$REPORT_DIR/headers.txt"

                    grep \
                    -qi \
                    '^X-Frame-Options: DENY' \
                    "$REPORT_DIR/headers.txt"

                    grep \
                    -qi \
                    '^Referrer-Policy:' \
                    "$REPORT_DIR/headers.txt"

                    grep \
                    -qi \
                    '^Permissions-Policy:' \
                    "$REPORT_DIR/headers.txt"

                    grep \
                    -qi \
                    '^Content-Security-Policy:' \
                    "$REPORT_DIR/headers.txt"


                    if grep \
                        -Eqi \
                        '^Server:[[:space:]]*nginx/[0-9]' \
                        "$REPORT_DIR/headers.txt"
                    then
                        echo "La version Nginx est exposée."
                        exit 1
                    fi


                    printf \
                    'containerId=%s\\nruntimeUid=%s\\nreadonlyRootfs=%s\\npidsLimit=%s\\nmemoryLimit=%s\\nnanoCpus=%s\\ncapEffective=%s\\nnoNewPrivileges=%s\\nstatus=SUCCESS\\n' \
                    "$CONTAINER_ID" \
                    "$RUNTIME_UID" \
                    "$READ_ONLY" \
                    "$PIDS_LIMIT" \
                    "$MEMORY_LIMIT" \
                    "$CPU_LIMIT" \
                    "$CAP_EFFECTIVE" \
                    "$NO_NEW_PRIVS" \
                    > "$REPORT_DIR/runtime-hardening.properties"


                    echo
                    echo "=== HARDENING SECURITY GATE : OK ==="

                    cat \
                    "$REPORT_DIR/runtime-hardening.properties"
                '''
            }

            post {
                always {
                    archiveArtifacts(
                        artifacts: 'hardening-reports/**/*',
                        allowEmptyArchive: true,
                        fingerprint: true
                    )
                }
            }
        }

        stage('Nginx optimization checks') {
            steps {
                timeout(
                    time: 5,
                    unit: 'MINUTES'
                ) {
                    sh '''
                        set -eu

                        REPORT_DIR="nginx-optimization-reports"

                        rm -rf "$REPORT_DIR"

                        mkdir -p "$REPORT_DIR"


                        echo "=== Récupération index Angular ==="

                        curl \
                        -fsS \
                        "$FRONT_INTERNAL_URL/" \
                        > "$REPORT_DIR/index.html"


                        echo
                        echo "=== Recherche bundle JS hashé ==="

                        MAIN_JS="$(
                            node -e '
                                const fs =
                                    require("node:fs");

                                const html =
                                    fs.readFileSync(
                                        "nginx-optimization-reports/index.html",
                                        "utf8"
                                    );

                                const match =
                                    html.match(
                                        /src="([^"]*-[A-Za-z0-9]{8,}\\.js)"/
                                    );

                                if (!match) {
                                    console.error(
                                        "Bundle JS Angular hashé introuvable"
                                    );

                                    process.exit(1);
                                }

                                process.stdout.write(
                                    match[1]
                                );
                            '
                        )"


                        case "$MAIN_JS" in
                            /*)
                                ;;
                            *)
                                MAIN_JS="/$MAIN_JS"
                                ;;
                        esac


                        echo "Bundle principal : $MAIN_JS"


                        echo
                        echo "=== Cache index.html ==="

                        curl \
                        -fsS \
                        -D "$REPORT_DIR/index-headers.raw" \
                        -o /dev/null \
                        "$FRONT_INTERNAL_URL/index.html"


                        tr -d '\\r' \
                        < "$REPORT_DIR/index-headers.raw" \
                        > "$REPORT_DIR/index-headers.txt"


                        cat "$REPORT_DIR/index-headers.txt"


                        grep \
                        -Eqi \
                        '^Cache-Control:.*no-cache.*no-store.*must-revalidate' \
                        "$REPORT_DIR/index-headers.txt"


                        echo
                        echo "=== Cache version.json ==="

                        curl \
                        -fsS \
                        -D "$REPORT_DIR/version-headers.raw" \
                        -o /dev/null \
                        "$FRONT_INTERNAL_URL/version.json"


                        tr -d '\\r' \
                        < "$REPORT_DIR/version-headers.raw" \
                        > "$REPORT_DIR/version-headers.txt"


                        cat "$REPORT_DIR/version-headers.txt"


                        grep \
                        -Eqi \
                        '^Cache-Control:.*no-store' \
                        "$REPORT_DIR/version-headers.txt"


                        echo
                        echo "=== Cache bundle Angular ==="

                        curl \
                        -fsS \
                        -D "$REPORT_DIR/asset-headers.raw" \
                        -o /dev/null \
                        "$FRONT_INTERNAL_URL$MAIN_JS"


                        tr -d '\\r' \
                        < "$REPORT_DIR/asset-headers.raw" \
                        > "$REPORT_DIR/asset-headers.txt"


                        cat "$REPORT_DIR/asset-headers.txt"


                        grep \
                        -Eqi \
                        '^Cache-Control:.*max-age=31536000.*immutable' \
                        "$REPORT_DIR/asset-headers.txt"


                        echo
                        echo "=== Compression gzip ==="

                        curl \
                        -fsS \
                        -H 'Accept-Encoding: gzip' \
                        -D "$REPORT_DIR/gzip-headers.raw" \
                        -o /dev/null \
                        "$FRONT_INTERNAL_URL$MAIN_JS"


                        tr -d '\\r' \
                        < "$REPORT_DIR/gzip-headers.raw" \
                        > "$REPORT_DIR/gzip-headers.txt"


                        cat "$REPORT_DIR/gzip-headers.txt"


                        grep \
                        -Eqi \
                        '^Content-Encoding:[[:space:]]*gzip' \
                        "$REPORT_DIR/gzip-headers.txt"


                        grep \
                        -Eqi \
                        '^Vary:.*Accept-Encoding' \
                        "$REPORT_DIR/gzip-headers.txt"


                        echo
                        echo "=== Vérification sécurité conservée ==="

                        grep \
                        -Eqi \
                        '^X-Content-Type-Options:[[:space:]]*nosniff' \
                        "$REPORT_DIR/gzip-headers.txt"


                        grep \
                        -Eqi \
                        '^Content-Security-Policy:' \
                        "$REPORT_DIR/gzip-headers.txt"


                        printf \
                        'mainJs=%s\\nindexCache=NO_CACHE\\nversionCache=NO_STORE\\nassetCache=IMMUTABLE_1Y\\ngzip=ENABLED\\nstatus=SUCCESS\\n' \
                        "$MAIN_JS" \
                        > "$REPORT_DIR/summary.properties"


                        echo
                        echo "=== NGINX OPTIMIZATION GATE : OK ==="

                        cat \
                        "$REPORT_DIR/summary.properties"
                    '''
                }
            }

            post {
                always {
                    archiveArtifacts(
                        artifacts: 'nginx-optimization-reports/**/*',
                        allowEmptyArchive: true,
                        fingerprint: true
                    )
                }
            }
        }

        stage('Smoke tests') {
            steps {
                sh '''
                    set -eu

                    echo "Attente du démarrage de bank-front..."

                    attempt=1

                    while true
                    do
                        HTTP_CODE="$(
                            curl \
                            -sS \
                            --connect-timeout 3 \
                            --max-time 5 \
                            -o frontend-health.json \
                            -w '%{http_code}' \
                            "$FRONT_INTERNAL_URL/health" ||
                            true
                        )"

                        if [ "$HTTP_CODE" = "200" ]; then
                            break
                        fi

                        if [ "$attempt" -ge 12 ]; then
                            echo "bank-front ne répond pas après 60 secondes."
                            echo "Dernier code HTTP : $HTTP_CODE"

                            cat frontend-health.json 2>/dev/null || true
                            docker compose ps
                            docker compose logs --tail=100 bank-front

                            exit 1
                        fi

                        echo "Tentative $attempt/12 — HTTP $HTTP_CODE"

                        attempt=$((attempt + 1))
                        sleep 5
                    done

                    echo
                    echo "=== Health frontend ==="
                    cat frontend-health.json

                    grep -q '"status":"UP"' frontend-health.json
                    grep -q '"service":"bank-front"' frontend-health.json

                    echo
                    echo "=== Backend via Nginx ==="

                    BACKEND_HTTP_CODE="$(
                        curl \
                        -sS \
                        --connect-timeout 3 \
                        --max-time 10 \
                        -o backend-health.json \
                        -w '%{http_code}' \
                        "$FRONT_INTERNAL_URL/actuator/health" ||
                        true
                    )"

                    if [ "$BACKEND_HTTP_CODE" != "200" ]; then
                        echo "Healthcheck backend en échec."
                        echo "Code HTTP : $BACKEND_HTTP_CODE"

                        cat backend-health.json 2>/dev/null || true
                        exit 1
                    fi

                    cat backend-health.json

                    grep -q '"status":"UP"' backend-health.json

                    echo
                    echo "=== Page Angular ==="

                    curl \
                    -fsS \
                    --connect-timeout 3 \
                    --max-time 10 \
                    "$FRONT_INTERNAL_URL/" |
                    grep -q '<bank-root'

                    echo "Composant bank-root détecté"
                    echo
                    echo "Déploiement frontend validé"

                    set -eu

                    echo "=== Version déployée ==="

                    curl \
                    -fsS \
                    --connect-timeout 3 \
                    --max-time 10 \
                    "$FRONT_INTERNAL_URL/version.json" \
                    > deployed-version.json

                    cat deployed-version.json

                    node -e '
                        const fs = require("node:fs");

                        const deployed = JSON.parse(
                            fs.readFileSync(
                                "deployed-version.json",
                                "utf8"
                            )
                        );

                        const expected = {
                            application: "bank-front",
                            version: process.env.APP_VERSION,
                            image: process.env.IMAGE_REF,
                            gitCommit: process.env.GIT_COMMIT_SHA,
                            gitShortSha: process.env.GIT_SHORT_SHA,
                            buildNumber: Number(process.env.BUILD_NUMBER),
                            buildDate: process.env.BUILD_DATE
                        };

                        for (const [key, expectedValue] of Object.entries(expected)) {
                            const actualValue = deployed[key];

                            if (actualValue !== expectedValue) {
                                throw new Error(
                                    `${key}: attendu=${expectedValue}, obtenu=${actualValue}`
                                );
                            }
                        }

                        console.log(
                            `Version déployée validée : ${deployed.version}`
                        );

                        console.log(
                            `Image déployée validée : ${deployed.image}`
                        );
                    '
                    echo
                    echo "=== Vérification de la preuve de déploiement ==="

                    test \
                    -f deployed-image.properties

                    DEPLOYED_DIGEST="$(
                        sed -n \
                        's/^digest=//p' \
                        deployed-image.properties |
                        head -n 1
                    )"

                    DEPLOYED_IMMUTABLE_REF="$(
                        sed -n \
                        's/^immutableRef=//p' \
                        deployed-image.properties |
                        head -n 1
                    )"

                    if [ "$DEPLOYED_DIGEST" != "$IMAGE_DIGEST" ]; then
                        echo "Digest déployé incohérent."
                        echo "Attendu : $IMAGE_DIGEST"
                        echo "Déployé : $DEPLOYED_DIGEST"
                        exit 1
                    fi

                    if [ "$DEPLOYED_IMMUTABLE_REF" != "$IMMUTABLE_IMAGE_REF" ]; then
                        echo "Référence déployée incohérente."
                        echo "Attendue : $IMMUTABLE_IMAGE_REF"
                        echo "Déployée : $DEPLOYED_IMMUTABLE_REF"
                        exit 1
                    fi

                    echo "Digest déployé validé : $DEPLOYED_DIGEST"
                    echo "Référence immuable validée : $DEPLOYED_IMMUTABLE_REF"
                '''
            }
        }
    }

    post {
        success {
            echo 'Pipeline frontend terminé avec succès.'
        }

        failure {
            echo 'Échec du pipeline frontend.'

            sh '''
                docker compose ps || true

                docker compose logs \
                --tail=150 \
                bank-front || true
            '''
        }

        always {
            archiveArtifacts(
                artifacts: '''
                    build-metadata.properties,
                    deployed-version.json,
                    deployed-image.properties,
                    published-image.properties,
                    published-manifest.json,
                    published-manifest.headers,
                    release-manifest.json,
                    release-manifest.headers
                ''',
                allowEmptyArchive: true,
                fingerprint: true
            )

            echo "Build Jenkins : ${env.BUILD_NUMBER}"
            echo "Version       : ${env.APP_VERSION ?: 'inconnue'}"
            echo "Tag image     : ${env.IMAGE_REF ?: 'inconnue'}"
            echo "Digest        : ${env.IMAGE_DIGEST ?: 'inconnu'}"
            echo "Image immuable: ${env.IMMUTABLE_IMAGE_REF ?: 'inconnue'}"
            echo "Commit Git    : ${env.GIT_COMMIT_SHA ?: 'inconnu'}"
        }
    }
}
