import UIKit
import Capacitor
import FilesystemPlugin
import SharePlugin

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = KnotListBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

private final class KnotListBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // Keep these SPM plugin classes linked so Capacitor can resolve the
        // class names listed in capacitor.config.json at runtime.
        bridge?.registerPluginType(FilesystemPlugin.self)
        bridge?.registerPluginType(SharePlugin.self)
    }
}
